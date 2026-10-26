"""Everything the Instagram connector reads and writes in Supabase, through the AI worker's PostgREST client
with the service role, so every query scopes by account or user itself.

The same tables and functions the sync worker uses for WhatsApp: accounts and account_credentials,
sync_state, ingest_instagram (ingest_whatsapp's twin), whatsapp_mark_read and whatsapp_set_receipt (which
only look at the account), the attachments bucket, the outbox and mail_actions. Only IDs, counts and
error codes are ever logged."""

from __future__ import annotations

import time
import urllib.request
from datetime import datetime, timezone
from typing import Any

from ... import log
from ...analytics import Analytics, event
from ...fields import ADDRESS, BODY
from ...supabase import Supabase, SupabaseError
from ...vault import Vault
from .sealing import UserSealer, ensure_user_key, open_json, seal_json

BUCKET = "attachments"
MAX_FILE_BYTES = 50 * 1024 * 1024  # the sync worker's limit, Supabase's default upload limit
INLINE = ("image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "audio/mp4")
STATE_SCOPE = "instagram_inbox"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, db: Supabase, vault: Vault, *, encryption_key: str, key_wrapping_key: str, encrypt_addresses: bool):
        self.db = db
        self.vault = vault
        self.encryption_key = encryption_key
        self.key_wrapping_key = key_wrapping_key
        self.encrypt_addresses = encrypt_addresses
        self.analytics = Analytics(db)
        self._keyed: set[str] = set()  # users whose data key is known to exist

    # -- accounts ---------------------------------------------------------------------------------------

    def accounts(self) -> list[dict[str, Any]]:
        """Every Instagram account, with when its sign-in last changed (a new sign-in restarts it)."""
        return self.db.select("accounts", {"select": "id,user_id,status,account_credentials(updated_at)", "provider": "eq.instagram"})

    def credentials(self, account_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        """What the app saved (username, and a password until it has been used) and the saved session."""
        row = self.db.first("account_credentials", {"select": "ciphertext,refreshed", "account_id": f"eq.{account_id}"})
        if not row:
            return None, None
        creds = open_json(row["ciphertext"], self.encryption_key) if row.get("ciphertext", "").startswith("v1:") else None
        session = open_json(row["refreshed"], self.encryption_key) if (row.get("refreshed") or "").startswith("v1:") else None
        return creds, session

    def save_session(self, account_id: str, username: str, settings: dict[str, Any]) -> None:
        """instagrapi's settings (the device, its IDs and the session), sealed. Writing refreshed does not
        move updated_at, so it never restarts the account."""
        self.db.update("account_credentials", {"account_id": f"eq.{account_id}"}, {"refreshed": seal_json({"username": username, "settings": settings}, self.encryption_key)}, minimal=True)

    def forget_password(self, account_id: str, username: str) -> str | None:
        """Once signed in the password is not kept: later runs use the session, and a sign-out needs you.
        Returns the sign-in's new updated_at."""
        rows = self.db.update("account_credentials", {"account_id": f"eq.{account_id}"}, {"ciphertext": seal_json({"username": username}, self.encryption_key)})
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

    def set_detail(self, account_id: str, detail: str | None) -> None:
        self.db.update("accounts", {"id": f"eq.{account_id}"}, {"status_detail": detail}, minimal=True)

    def touch(self, account_id: str) -> None:
        try:
            self.db.update("accounts", {"id": f"eq.{account_id}"}, {"last_synced_at": now_iso()}, minimal=True)
        except SupabaseError:
            pass

    def emit(self, user_id: str, name: str, **props: Any) -> None:
        self.analytics.emit(user_id, [event(name, **props)])

    def sealer(self, user_id: str) -> UserSealer:
        """The user's keys for sealing and indexing, made first if they have none."""
        if user_id not in self._keyed:
            ensure_user_key(self.db, self.key_wrapping_key, user_id)  # before the Vault looks, so it finds it
            self._keyed.add(user_id)
        keys = self.vault.keys_for(user_id)
        if keys is None:
            raise RuntimeError("no user key")
        return UserSealer(self.vault, keys, user_id, self.encrypt_addresses)

    # -- sync state -------------------------------------------------------------------------------------

    def newest_seen(self, account_id: str) -> int | None:
        """The time of the newest message stored by an earlier poll, in microseconds. None before the first."""
        row = self.db.first("sync_state", {"select": "sync_token", "account_id": f"eq.{account_id}", "scope": f"eq.{STATE_SCOPE}"})
        token = (row or {}).get("sync_token") or ""
        return int(token) if token.isdigit() else None

    def save_newest(self, account_id: str, timestamp_us: int) -> None:
        self.db.upsert("sync_state", {"account_id": account_id, "scope": STATE_SCOPE, "sync_token": str(timestamp_us)}, "account_id,scope")

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

    def save_file(self, user_id: str, message_id: str, attachment_id: str, data: bytes, mime_type: str) -> None:
        """A file in the private attachments bucket at <user id>/<message id>/<attachment id>, as WhatsApp's."""
        path = f"{user_id}/{message_id}/{attachment_id}"
        self.db.upload(BUCKET, path, data, mime_type if mime_type in INLINE else "application/octet-stream")
        self.db.update("attachments", {"id": f"eq.{attachment_id}"}, {"storage_path": path, "size_bytes": len(data)}, minimal=True)

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
            return str(open_json(sealed, self.store.encryption_key))
        except Exception:
            return None

    def done(self) -> None:
        try:
            self.store.db.delete("instagram_sign_ins", {"account_id": f"eq.{self.account['id']}"})
        except SupabaseError:
            pass


def fetch(url: str, proxy: str | None, user_agent: str | None, limit: int = MAX_FILE_BYTES, timeout: float = 60) -> bytes | None:
    """A file from Instagram's CDN, as the app would fetch it and through the proxy when one is set. None
    when it is too large to keep."""
    handlers = [urllib.request.ProxyHandler({"http": proxy, "https": proxy})] if proxy else []
    opener = urllib.request.build_opener(*handlers)
    request = urllib.request.Request(url, headers={"User-Agent": user_agent or "Instagram"})
    with opener.open(request, timeout=timeout) as res:
        data = res.read(limit + 1)
    return None if len(data) > limit else data

