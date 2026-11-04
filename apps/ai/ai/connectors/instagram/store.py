"""Everything the Instagram connector reads and writes in Supabase, through the AI worker's PostgREST client
with the service role, so every query scopes by account or user itself.

The same tables and functions the sync worker uses for WhatsApp: accounts and account_credentials,
sync_state, ingest_instagram (ingest_whatsapp's twin), whatsapp_mark_read and whatsapp_set_receipt (which
only look at the account), the attachments bucket, the outbox and mail_actions. Only IDs, counts and
error codes are ever logged."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

from ... import log
from ...analytics import Analytics, event
from ...crypto import encrypt_bytes, encrypt_bytes_at
from ...fields import ADDRESS, ATTACHMENT_DATA, BODY, FILENAME, NAME, OUTBOX_FILE_DATA
from ...supabase import Supabase, SupabaseError
from ...tls import CONTEXT
from ...vault import KeyUnavailable, Vault
from .credentials import OFFICIAL, PRIVATE
from .sealing import AccountSealer, UserSealer, ensure_user_key, open_handoff, open_legacy

BUCKET = "attachments"
# What a queued row whose text, recipient or files were not sealed for it is failed with (the worker's UNVERIFIED).
UNVERIFIED = "Nothing was sent: this message could not be verified. Write it again."
CODE_KEEP_S = 10 * 60  # a typed sign-in code nobody took is cleared after this (the app's write sets updated_at)
MAX_FILE_BYTES = 50 * 1024 * 1024  # the sync worker's limit, Supabase's default upload limit
INLINE = ("image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "audio/mp4")
MB = 1024 * 1024
GB = 1024 * MB
GRACE = 0.1  # a message that has started saving may finish this far past the cap (storage-rules.ts)
# What the database still needs to know about a name now that it is sealed (apps/worker/src/ingest/file-hints.ts).
KEPT = re.compile(r"(receipt|invoice|ticket|statement|booking|itinerary|confirmation|reservation|boarding|voucher|order|tax|bill|payslip|payment|purchase|quotation|quote|rechnung|factura|factuur|recibo)", re.I)


def video_copy_max() -> int:
    """Videos over this are kept as a link to the original (VIDEO_COPY_MAX_MB, 25)."""
    try:
        return int(float(os.environ.get("VIDEO_COPY_MAX_MB") or 25) * MB)
    except ValueError:
        return 25 * MB


def seat_cap() -> int:
    try:
        return int(float(os.environ.get("STORAGE_CAP_GB") or 20) * GB)
    except ValueError:
        return 20 * GB


def file_hints(filename: str) -> dict[str, Any]:
    """file_ext, keep_hint and is_sticker for a name: the only things about it that reach SQL."""
    m = re.search(r"\.([A-Za-z0-9]{1,8})$", filename or "")
    return {"file_ext": m.group(1).lower() if m else None, "keep_hint": bool(KEPT.search(filename or "")), "is_sticker": bool(re.match(r"Sticker\.", filename or "", re.I))}


def content_hash(index_key: bytes, data: bytes) -> str:
    """HMAC-SHA256 of the file under the user's index key, base64url without padding (contentHash in packages/crypto)."""
    return base64.urlsafe_b64encode(hmac.new(index_key, data, hashlib.sha256).digest()).decode("ascii").rstrip("=")


def cap_allows(used: int, cap: int, started: bool) -> bool:
    """Under the cap always; in the 10% grace band only for a message that already has a saved file; never past it."""
    if used < cap:
        return True
    return started and used < cap * (1 + GRACE)


AVATARS = "avatars"
AVATAR_MAX_BYTES = 2 * MB  # the sync worker's photo limit (photos/store.ts)
AVATAR_REFRESH = timedelta(days=7)  # an Instagram photo is looked at again at most this often
# Instagram's grey silhouette for accounts with no photo: not worth saving.
DEFAULT_AVATAR = "44884218_345707102882519_2446069589734326272_n"


def image_type(data: bytes) -> str | None:
    """What a photo looks like from its first bytes (imageType in photos/site-icon.ts). Anything else is not stored."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:3] == b"GIF":
        return "image/gif"
    return None


def photo_due(contact: dict[str, Any], now: datetime) -> bool:
    """Whether a contact's photo should be fetched from Instagram: when it has none, or it is Instagram's own and
    a week old. A photo from the address book or WhatsApp stays (photos/store.ts ranks Instagram with WhatsApp)."""
    if not contact.get("avatar_path"):
        return True
    if contact.get("avatar_source") != "instagram":
        return False
    stamp = contact.get("avatar_updated_at")
    try:
        return not stamp or now - datetime.fromisoformat(str(stamp).replace("Z", "+00:00")) >= AVATAR_REFRESH
    except ValueError:
        return True


STATE_SCOPE = "instagram_inbox"
OFFICIAL_SCOPE = "instagram_official_inbox"  # its own, so switching a username from a personal account to a Business one starts clean


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, db: Supabase, vault: Vault, *, encryption_key: str, key_wrapping_key: str, encrypt_addresses: bool):
        self.db = db
        self.vault = vault
        self.encryption_key = encryption_key  # the old static key: reads "v1:" values made before per-user keys; empty once retired
        self.key_wrapping_key = key_wrapping_key
        self.encrypt_addresses = encrypt_addresses
        self.analytics = Analytics(db)
        self._keyed: set[str] = set()  # users whose data key is known to exist
        self.creds = AccountSealer(db, vault, encryption_key, self._ensure_key)  # stored sign-ins and sessions, "v2:" under the owner's key

    # -- accounts ---------------------------------------------------------------------------------------

    def accounts(self) -> list[dict[str, Any]]:
        """Every Instagram account, with when its sign-in last changed (a new sign-in restarts it)."""
        return self.db.select("accounts", {"select": "id,user_id,status,account_credentials(updated_at)", "provider": "eq.instagram"})

    def credentials(self, account_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        """What the app saved (username, and a password until it has been used) and the saved session."""
        row = self.db.first("account_credentials", {"select": "ciphertext,refreshed", "account_id": f"eq.{account_id}"})
        if not row:
            return None, None
        creds = self.creds.open(account_id, row["ciphertext"]) if self.creds.sealed(row.get("ciphertext")) else None
        session = self.creds.open(account_id, row["refreshed"]) if self.creds.sealed(row.get("refreshed")) else None
        return creds, session

    def save_session(self, account_id: str, username: str, settings: dict[str, Any]) -> None:
        """instagrapi's settings (the device, its IDs and the session), sealed. Writing refreshed does not
        move updated_at, so it never restarts the account."""
        self.db.update("account_credentials", {"account_id": f"eq.{account_id}"}, {"refreshed": self.creds.seal(account_id, {"username": username, "settings": settings})}, minimal=True)

    def save_token(self, account_id: str, token: str, expires_at: int) -> None:
        """A Business or Creator account's refreshed access token (UNIX seconds it expires at), sealed. Like the
        session, it goes in refreshed, which does not move updated_at, so refreshing never restarts the account."""
        self.db.update("account_credentials", {"account_id": f"eq.{account_id}"}, {"refreshed": self.creds.seal(account_id, {"kind": OFFICIAL, "accessToken": token, "expiresAt": expires_at})}, minimal=True)

    def forget_password(self, account_id: str, username: str, proxy: str | None = None) -> str | None:
        """Once signed in the password is not kept: later runs use the session, and a sign-out needs you.
        The account's own proxy, if it has one, is kept. Returns the sign-in's new updated_at."""
        kept: dict[str, Any] = {"kind": PRIVATE, "username": username, **({"proxy": proxy} if proxy else {})}
        rows = self.db.update("account_credentials", {"account_id": f"eq.{account_id}"}, {"ciphertext": self.creds.seal(account_id, kept)})
        return rows[0].get("updated_at") if rows else None

    def signed_in(self, account: dict[str, Any], username: str) -> None:
        self.db.update("accounts", {"id": f"eq.{account['id']}"}, {"label": "Instagram", "status_detail": None}, minimal=True)
        self.emit(account["user_id"], "account_connect", provider="instagram", step="sign_in", outcome="done")

    def set_status(self, account: dict[str, Any], status: str, detail: str | None = None) -> None:
        """Like the sync worker's setAccountStatus, with the same usage events."""
        before = self.db.first("accounts", {"select": "status,created_at,last_synced_at", "id": f"eq.{account['id']}"})
        patch: dict[str, Any] = {"status": status, "status_detail": detail}
        if status == "connected":
            patch["last_synced_at"] = now_iso()
        self.db.update("accounts", {"id": f"eq.{account['id']}"}, patch, minimal=True)
        if not before or before.get("status") == status:
            return
        user = account["user_id"]
        if status == "error":
            self.emit(user, "sync_error", provider="instagram", code="account_error")
            if before.get("status") == "connecting":
                self.emit(user, "account_connect", provider="instagram", step="sync", outcome="failed", code="connect_failed")
        elif status == "connected":
            if before.get("status") == "connecting":
                self.emit(user, "account_connect", provider="instagram", step="sync", outcome="done")
            if not before.get("last_synced_at"):
                started = datetime.fromisoformat(str(before.get("created_at")).replace("Z", "+00:00"))
                self.emit(user, "first_sync_done", provider="instagram", secs=round(max(0.0, (datetime.now(timezone.utc) - started).total_seconds())))

    def clear_stale_codes(self, at: datetime | None = None) -> None:
        """Takes sign-in codes nobody collected (typed after the sign-in gave up) off instagram_sign_ins once they are
        CODE_KEEP_S old. A code is taken within seconds while a sign-in waits, so a live one is never lost."""
        before = ((at or datetime.now(timezone.utc)) - timedelta(seconds=CODE_KEEP_S)).isoformat()
        self.db.update("instagram_sign_ins", {"code": "not.is.null", "updated_at": f"lt.{before}"}, {"code": None}, minimal=True)

    def set_detail(self, account_id: str, detail: str | None) -> None:
        self.db.update("accounts", {"id": f"eq.{account_id}"}, {"status_detail": detail}, minimal=True)

    def touch(self, account_id: str) -> None:
        try:
            self.db.update("accounts", {"id": f"eq.{account_id}"}, {"last_synced_at": now_iso()}, minimal=True)
        except SupabaseError:
            pass

    def emit(self, user_id: str, name: str, **props: Any) -> None:
        self.analytics.emit(user_id, [event(name, **props)])

    def _ensure_key(self, user_id: str) -> None:
        if user_id not in self._keyed:
            ensure_user_key(self.db, self.key_wrapping_key, user_id)
            self._keyed.add(user_id)

    def sealer(self, user_id: str) -> UserSealer:
        """The user's keys for sealing and indexing, made first if they have none."""
        self._ensure_key(user_id)  # before the Vault looks, so it finds it
        keys = self.vault.keys_for(user_id)
        if keys is None:
            raise RuntimeError("no user key")
        return UserSealer(self.vault, keys, user_id, self.encrypt_addresses)

    # -- sync state -------------------------------------------------------------------------------------

    def newest_seen(self, account_id: str, scope: str = STATE_SCOPE) -> int | None:
        """The time of the newest message stored by an earlier poll, in microseconds. None before the first."""
        row = self.db.first("sync_state", {"select": "sync_token", "account_id": f"eq.{account_id}", "scope": f"eq.{scope}"})
        token = (row or {}).get("sync_token") or ""
        return int(token) if token.isdigit() else None

    def save_newest(self, account_id: str, timestamp_us: int, scope: str = STATE_SCOPE) -> None:
        self.db.upsert("sync_state", {"account_id": account_id, "scope": scope, "sync_token": str(timestamp_us)}, "account_id,scope")

    # -- messages ---------------------------------------------------------------------------------------

    def ingest(self, account_id: str, payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Stores a thread's messages in one call, oldest first. One result per message, in order."""
        if not payloads:
            return []
        out = self.db.rpc("ingest_instagram_batch", {"p_account_id": account_id, "p_msgs": payloads})
        return out if isinstance(out, list) else []

    def mark_read_on_phone(self, account_id: str, sealer: UserSealer, thread_ids: list[str]) -> int:
        """Threads you have seen in Instagram itself are marked read here too. Nothing is sent to Instagram."""
        if not thread_ids:
            return 0
        jids = [sealer.address(t) or t for t in thread_ids]
        indexes = [sealer.chat_index(t) for t in thread_ids]
        return int(self.db.rpc("whatsapp_mark_read", {"p_account_id": account_id, "p_chat_jids": jids, "p_chat_indexes": indexes}) or 0)

    def mark_seen(self, account_id: str, sealer: UserSealer, thread_id: str, seen_us: int) -> int:
        """Your messages in a thread that the others have seen, up to that time, are shown as seen. Nothing is sent to Instagram."""
        seen_at = datetime.fromtimestamp(seen_us / 1_000_000, timezone.utc).isoformat()
        args = {"p_account_id": account_id, "p_thread_provider_id": sealer.address(thread_id) or thread_id, "p_seen_at": seen_at, "p_thread_index": sealer.chat_index(thread_id)}
        return int(self.db.rpc("mark_seen_up_to", args) or 0)

    def usage(self, user_id: str) -> tuple[int, int]:
        """(bytes used, cap) for this person: a team pools its seats' storage, as team_storage_for says."""
        team = self.db.rpc("team_storage_for", {"p_user": user_id})
        if isinstance(team, dict) and isinstance(team.get("seats"), (int, float)):
            return int(team.get("bytes") or 0), int(team["seats"] * seat_cap())
        rows = self.db.select("storage_usage", {"select": "bytes", "user_id": f"eq.{user_id}"})
        return sum(int(r.get("bytes") or 0) for r in rows), seat_cap()

    def set_hints(self, attachment_id: str, filename: str) -> None:
        """The sealed name's three plain hints. The name itself is sealed when the message is ingested."""
        try:
            self.db.update("attachments", {"id": f"eq.{attachment_id}"}, file_hints(filename), minimal=True)
        except SupabaseError as err:
            log.warn("instagram file hints not saved", attachment=attachment_id, code=err.status)

    def sealed_name(self, user_id: str, filename: str) -> str | None:
        return self.vault.seal(user_id, FILENAME, filename)

    def save_file(self, user_id: str, message_id: str, attachment_id: str, data: bytes, mime_type: str, kind: str = "image", account_id: str | None = None) -> str:
        """A file in the private attachments bucket at <user id>/<message id>/<attachment id>, as WhatsApp's, by the
        rules of the sync worker's keepFile: nothing over 50 MB; a video over 25 MB stays at Instagram
        (not_kept 'video_link'); at the storage cap it is not copied (not_kept 'over_cap'); the same file again
        in an account points at the copy already stored; the bytes are sealed with the user's key, with sealed and
        content_hash set. Returns "saved", "reused", "too_large", "video_link" or "over_cap"."""
        size = len(data)
        if size > MAX_FILE_BYTES:
            return "too_large"
        unsaved = {"id": f"eq.{attachment_id}", "storage_path": "is.null"}
        if kind == "video" and size > video_copy_max():
            self.db.update("attachments", unsaved, {"not_kept": "video_link"}, minimal=True)
            return "video_link"
        keys = self.vault.keys_for(user_id)
        sealing = bool(self.vault.encrypt) and keys is not None
        digest = content_hash(keys.index, data) if keys is not None else None
        if digest and account_id:
            copy = self.db.select(
                "attachments",
                {"select": "storage_path,sealed,messages!inner(account_id)", "user_id": f"eq.{user_id}", "content_hash": f"eq.{digest}", "messages.account_id": f"eq.{account_id}", "storage_path": "not.is.null", "limit": "1"},
            )
            if copy and copy[0].get("storage_path"):
                self.db.update(
                    "attachments",
                    {"id": f"eq.{attachment_id}"},
                    {"storage_path": copy[0]["storage_path"], "sealed": bool(copy[0].get("sealed")), "content_hash": digest, "size_bytes": size, "not_kept": None},
                    minimal=True,
                )
                return "reused"
        try:
            used, cap = self.usage(user_id)
        except Exception:  # unreadable usage fails open, as the sync worker does
            used, cap = 0, seat_cap()
        if not cap_allows(used, cap, False):  # an Instagram message carries one file, so it has not started saving
            self.db.update("attachments", unsaved, {"not_kept": "over_cap"}, minimal=True)
            return "over_cap"
        path = f"{user_id}/{message_id}/{attachment_id}"
        content_type = mime_type if mime_type in INLINE else "application/octet-stream"
        if sealing:
            # Sealed before upload, in the format of packages/crypto encryptBytes (what the sync worker does for
            # WhatsApp files), under the attachment_data field, bound to its place once SEAL_BOUND_FIELDS is on. The
            # stored type is generic: the real one is on the row.
            data = encrypt_bytes_at(keys, ATTACHMENT_DATA, f"{BUCKET}/{path}", data) if self.vault.seal_bound else encrypt_bytes(keys, ATTACHMENT_DATA, data)  # type: ignore[arg-type]
            content_type = "application/octet-stream"
        self.db.upload(BUCKET, path, data, content_type)
        self.db.update("attachments", {"id": f"eq.{attachment_id}"}, {"storage_path": path, "sealed": sealing, "content_hash": digest, "size_bytes": size, "not_kept": None}, minimal=True)
        return "saved"

    # -- contact photos ---------------------------------------------------------------------------------

    def contact_to_photograph(self, user_id: str, sealer: UserSealer, pk: str) -> dict[str, Any] | None:
        """The contact an Instagram person was filed under and what photo it has, or None when there is no
        contact yet or its photo is not due."""
        link = self.db.first("contact_identities", {"select": "contact_id", "user_id": f"eq.{user_id}", "kind": "eq.instagram", "value_index": f"eq.{sealer.address_index(pk)}"})
        if not link:
            return None
        contact = self.db.first("contacts", {"select": "id,avatar_path,avatar_source,avatar_updated_at", "id": f"eq.{link['contact_id']}", "user_id": f"eq.{user_id}"})
        return contact if contact and photo_due(contact, datetime.now(timezone.utc)) else None

    def save_contact_photo(self, user_id: str, contact: dict[str, Any], data: bytes) -> bool:
        """The photo in the private avatars bucket at <user id>/<contact id>, as the sync worker saves them
        (avatars are not sealed), with source 'instagram'. Never replaces one from another source."""
        kind = image_type(data)
        if not kind or len(data) > AVATAR_MAX_BYTES:
            return False
        if contact.get("avatar_path") and contact.get("avatar_source") != "instagram":
            return False
        path = f"{user_id}/{contact['id']}"
        self.db.upload(AVATARS, path, data, kind)
        self.db.update("contacts", {"id": f"eq.{contact['id']}"}, {"avatar_path": path, "avatar_source": "instagram", "avatar_updated_at": now_iso()}, minimal=True)
        return True

    # -- outbox -----------------------------------------------------------------------------------------

    def queued_outbox(self, account_id: str) -> list[dict[str, Any]]:
        """Replies queued in the app for this account's Instagram threads, oldest first."""
        return self.db.select(
            "outbox",
            {
                "select": "id,user_id,body,attachment_count,thread_id,threads!inner(account_id,channel,user_id,provider_thread_id,is_group,group_name)",
                "status": "eq.queued",
                "threads.account_id": f"eq.{account_id}",
                "threads.channel": "eq.instagram",
                "order": "created_at",
                "limit": "10",
            },
        )

    def queued_new_chats(self, account_id: str) -> list[dict[str, Any]]:
        """New conversations queued in the app for this account: no thread yet and one sealed recipient,
        oldest first. Only the sign-in connector can send them."""
        return self.db.select(
            "outbox",
            {
                "select": "id,user_id,account_id,body,attachment_count,to_addresses",
                "status": "eq.queued",
                "account_id": f"eq.{account_id}",
                "thread_id": "is.null",
                "order": "created_at",
                "limit": "10",
            },
        )

    def first_messages_since(self, account_id: str, since: datetime) -> int:
        """How many new conversations this account has actually sent since then. The app sets outbox.account_id
        only on a first message (a reply names its thread instead and leaves account_id empty), and that stays
        after link_thread, so sent rows with an account_id are exactly the first messages sent. Failed, queued
        and sending rows never count."""
        return self.db.count("outbox", {"account_id": f"eq.{account_id}", "status": "eq.sent", "sent_at": f"gte.{since.isoformat()}"})

    def count_outbox_files(self, outbox_id: str) -> int:
        """How many files the app has added to this outbox row so far."""
        return self.db.count("outbox_attachments", {"outbox_id": f"eq.{outbox_id}"})

    def outbox_files(self, outbox_id: str, limit: int) -> list[dict[str, Any]]:
        """The row's files in the order they were added (outbox-attachments.ts loadAttachmentFiles)."""
        return self.db.select(
            "outbox_attachments",
            {"select": "id,user_id,storage_path,filename,mime_type,size_bytes,position", "outbox_id": f"eq.{outbox_id}", "order": "position,created_at", "limit": str(limit)},
        )

    def download_outbox_file(self, path: str) -> bytes | None:
        """An uploaded file's bytes, None when it is gone. The caller has checked the path is the user's own."""
        try:
            return self.db.download(BUCKET, path)
        except SupabaseError as err:
            if err.status in (400, 404):
                return None
            raise

    def open_outbox_file(self, user_id: str, data: bytes, path: str) -> bytes | None:
        """An uploaded file's plain bytes, opened strictly for the path it was read from: sealed by the app
        (OUTBOX_FILE_DATA, bound to "attachments/<path>"), or as they are while encryption is off. None when it is refused.
        A key that cannot be had right now raises, so the row is tried again."""
        try:
            return self.vault.open_bound_file(user_id, OUTBOX_FILE_DATA, data, f"{BUCKET}/{path}")
        except KeyUnavailable:
            raise
        except Exception as err:
            log.warn("outbox file refused", user=user_id, code=log.code_of(err))
            return None

    def _outbox_value(self, row: dict[str, Any], field: str, column: str, value: str | None, kind: str) -> str | None:
        """One sealed column of a queued row, opened only when it was sealed for that column of that row
        (packages/crypto/src/places.ts). None when it is refused (logged with its code); "" for no value."""
        try:
            return self.vault.open_bound(row["user_id"], field, value, [f"outbox.{column}"], row["id"], kind) or ""
        except KeyUnavailable:
            raise
        except Exception as err:
            log.warn("outbox row refused", outbox=row["id"], code=log.code_of(err))
            return None

    def outbox_body(self, row: dict[str, Any]) -> str | None:
        """A queued row's body for sending, or None when it was not sealed for this row (fail the row with UNVERIFIED)."""
        return self._outbox_value(row, BODY, "body", row.get("body"), "content")

    def outbox_recipient(self, row: dict[str, Any], value: str | None) -> str | None:
        """One of a queued row's to_addresses for sending, or None when it was not sealed for this row."""
        return self._outbox_value(row, ADDRESS, "to_addresses", value, "address")

    def link_thread(self, outbox_id: str, thread_id: str) -> None:
        """Points a sent new conversation's row at its thread, so the app can open it."""
        self.db.update("outbox", {"id": f"eq.{outbox_id}", "thread_id": "is.null"}, {"thread_id": thread_id}, minimal=True)

    def last_inbound(self, thread_id: str) -> dict[str, Any] | None:
        """The newest message someone else sent in a thread: when (sent_at) and who from (sender_address,
        sealed). Instagram lets a Business account reply only within 24 hours of it, and to that person."""
        return self.db.first(
            "messages",
            {"select": "sent_at,sender_address", "thread_id": f"eq.{thread_id}", "direction": "eq.inbound", "order": "sent_at.desc"},
        )

    def claim(self, outbox_id: str) -> bool:
        """Marks a queued reply as sending. False when something else already took it."""
        return len(self.db.update("outbox", {"id": f"eq.{outbox_id}", "status": "eq.queued"}, {"status": "sending"})) == 1

    def settle(self, outbox_id: str, provider_message_id: str) -> bool:
        """Records a reply Instagram took, retried, so a database hiccup never invites sending it twice."""
        for attempt in range(3):
            try:
                self.db.update("outbox", {"id": f"eq.{outbox_id}"}, {"status": "sent", "provider_message_id": provider_message_id, "sent_at": now_iso(), "error": None}, minimal=True)
                return True
            except SupabaseError:
                time.sleep(1 + attempt)
        self.fail(outbox_id, "Sent, but could not be recorded. Check Instagram before sending again.")
        return False

    def fail(self, outbox_id: str, reason: str) -> None:
        self.db.update("outbox", {"id": f"eq.{outbox_id}"}, {"status": "failed", "error": reason}, minimal=True)

    def body(self, user_id: str, value: str | None) -> str:
        return self.vault.open(user_id, BODY, value) or ""

    def address(self, user_id: str, value: str | None) -> str:
        return self.vault.open(user_id, ADDRESS, value) or ""

    def name(self, user_id: str, value: str | None) -> str | None:
        """A stored name (a group's, sealed or plain) as text, or None when there is none."""
        return self.vault.open(user_id, NAME, value) or None

    # -- webhook hints ----------------------------------------------------------------------------------

    def take_hints(self, ig_user_id: str) -> list[dict[str, Any]]:
        """The webhook hints waiting for this Instagram account (oldest first), deleted as they are taken: a hint
        is only a nudge to read the inbox, so one that is lost costs a slower read, never a message."""
        rows = self.db.select(
            "meta_webhook_hints",
            {"select": "id,kind", "provider": "eq.instagram", "ig_user_id": f"eq.{ig_user_id}", "consumed_at": "is.null", "order": "id", "limit": "100"},
        )
        if rows:
            self.db.delete("meta_webhook_hints", {"id": "in.(" + ",".join(str(int(r["id"])) for r in rows) + ")"})
        return rows

    def prune_hints(self) -> None:
        """Drops hints more than a day old: the ones of an account that was paused and never took them."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        self.db.delete("meta_webhook_hints", {"created_at": f"lt.{cutoff}"})

    # -- actions ----------------------------------------------------------------------------------------

    def queued_actions(self, account_id: str) -> list[dict[str, Any]]:
        return self.db.select(
            "mail_actions",
            {
                "select": "id,user_id,thread_id,action,threads!inner(account_id,channel,provider_thread_id)",
                "status": "eq.queued",
                "threads.account_id": f"eq.{account_id}",
                "threads.channel": "eq.instagram",
                "order": "created_at",
                "limit": "20",
            },
        )

    def finish_action(self, action_id: str, error: str | None = None) -> None:
        patch = {"status": "failed", "error": error, "done_at": now_iso()} if error else {"status": "done", "done_at": now_iso()}
        try:
            self.db.update("mail_actions", {"id": f"eq.{action_id}"}, patch, minimal=True)
        except SupabaseError:
            pass

    def pending_receipts(self, account_id: str, thread_id: str) -> list[dict[str, Any]]:
        """Messages from others in a thread that Instagram has not been told you saw, newest first."""
        return self.db.select(
            "messages",
            {
                "select": "id,provider_message_id",
                "thread_id": f"eq.{thread_id}",
                "account_id": f"eq.{account_id}",
                "direction": "eq.inbound",
                "provider_meta->>receipt": "eq.pending",
                "order": "sent_at.desc",
                "limit": "500",
            },
        )

    def set_receipts(self, account_id: str, message_ids: list[str], state: str) -> None:
        if message_ids:
            self.db.rpc("whatsapp_set_receipt", {"p_account_id": account_id, "p_message_ids": message_ids, "p_state": state})


class SignInRow:
    """signin.Codes over public.instagram_sign_ins: the step shows in the app, which writes the code back."""

    ASK = {
        ("code", "email"): "Enter the code Instagram sent to your email.",
        ("code", "sms"): "Enter the code Instagram sent to your phone by SMS.",
        ("two_factor", "app"): "Enter the code from your authenticator app.",
        ("two_factor", "sms"): "Enter the two-factor code Instagram sent to your phone by SMS.",
    }

    def __init__(self, store: Store, account: dict[str, Any]):
        self.store = store
        self.account = account

    def ask(self, step: str, method: str | None, attempt: int) -> None:
        detail = self.ASK.get((step, method or ""), "Enter the code Instagram sent you.")
        if attempt > 1:
            detail = "Instagram did not accept that code. " + detail
        self.store.db.upsert(
            "instagram_sign_ins",
            {"account_id": self.account["id"], "user_id": self.account["user_id"], "step": step, "method": method, "code": None, "attempts": attempt},
            "account_id",
        )
        self.store.set_detail(self.account["id"], detail)
        log.info("instagram code asked", account=self.account["id"], step=step, method=method, attempt=attempt)

    def take(self) -> str | None:
        row = self.store.db.first("instagram_sign_ins", {"select": "code", "account_id": f"eq.{self.account['id']}"})
        sealed = (row or {}).get("code")
        if not sealed:
            return None
        # Cleared only if it is still the code just read, so one typed in the meantime is not lost.
        self.store.db.update("instagram_sign_ins", {"account_id": f"eq.{self.account['id']}", "code": f"eq.{sealed}"}, {"code": None}, minimal=True)
        try:
            if sealed.startswith("v1:"):  # typed before per-user handoffs: read while the old static key is still set
                return str(open_legacy(sealed, self.store.encryption_key))
            # Sealed by the web app under the owner's key, bound to this row's code.
            return str(open_handoff(self.store.vault, self.store.encryption_key, self.account["user_id"], "instagram_sign_ins", "code", self.account["id"], sealed))
        except Exception:
            return None

    def done(self) -> None:
        try:
            self.store.db.delete("instagram_sign_ins", {"account_id": f"eq.{self.account['id']}"})
        except SupabaseError:
            pass


# Where Instagram's files live: its own CDN, Facebook's (the Graph API hands out lookaside.fbsbx.com links) and
# instagram.com itself. The URLs come out of Instagram's answers, so they are checked, not trusted.
CDN_DOMAINS = ("cdninstagram.com", "fbcdn.net", "fbsbx.com", "instagram.com")


def cdn_url(url: str) -> bool:
    """Whether a file may be fetched from this address: HTTPS on port 443 to one of CDN_DOMAINS (or a subdomain), with no
    user part. Anything else (file://, ftp://, another host) is refused before a connection is made."""
    try:
        u = urlsplit(str(url).strip())
        host, port = (u.hostname or "").lower(), u.port
    except ValueError:
        return False
    return u.scheme == "https" and port in (None, 443) and "@" not in u.netloc and any(host == d or host.endswith("." + d) for d in CDN_DOMAINS)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a: Any, **k: Any) -> None:
        return None  # a redirect could leave the CDN: it surfaces as an HTTPError and the file is skipped


def fetch(url: str, proxy: str | None, user_agent: str | None, limit: int = MAX_FILE_BYTES, timeout: float = 60) -> bytes | None:
    """A file from Instagram's CDN, as the app would fetch it and through the proxy when one is set. None
    when it is too large to keep. Raises ValueError for an address off the CDN (see cdn_url), HTTPError for a redirect."""
    if not cdn_url(url):
        raise ValueError("instagram_file_host")
    handlers: list[Any] = [urllib.request.HTTPSHandler(context=CONTEXT), _NoRedirect()]  # the system's root certificates, which this Python lacks
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    opener = urllib.request.build_opener(*handlers)
    request = urllib.request.Request(url, headers={"User-Agent": user_agent or "Instagram"})
    with opener.open(request, timeout=timeout) as res:
        data = res.read(limit + 1)
    return None if len(data) > limit else data

