"""Instagram's direct inbox JSON, as the private API returns it, turned into what is stored: threads, people
and messages shaped for public.ingest_instagram, the same shape as the sync worker's WhatsApp payload.

Read from the raw JSON rather than instagrapi's models, so one item of a type the models do not know yet
cannot stop a whole poll. Pure functions, so they are unit tested on hand-written responses. Nothing here
logs or keeps content."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from ...fields import BODY, FILENAME, PREVIEW, QUOTE

SITE = "https://www.instagram.com"
UNSUPPORTED = "This message type is not shown here. Open Instagram to see it."
# Notices about the thread itself (someone joined, a call started) rather than messages.
SKIPPED = {"action_log", "video_call_event", "expired_placeholder", "csr_reminder", "typing"}


@dataclass(frozen=True)
class Person:
    pk: str
    username: str | None = None
    full_name: str | None = None
    picture: str | None = None  # profile_pic_url: signed and personal, fetched soon after and never logged

    @property
    def name(self) -> str:
        return (self.full_name or "").strip() or (self.username or "").strip() or "Instagram Contact"


@dataclass(frozen=True)
class Media:
    """A file to save from Instagram's CDN. The URL expires within days, so it is fetched soon after."""

    url: str
    filename: str
    mime_type: str
    kind: str  # the attachments table's kind: image, video or audio


@dataclass(frozen=True)
class Quoted:
    id: str
    sender_pk: str
    text: str


@dataclass(frozen=True)
class Item:
    id: str
    sender_pk: str
    timestamp_us: int
    type: str
    text: str
    preview: str
    media: Media | None = None
    quoted: Quoted | None = None
    reactions: tuple[tuple[str, str], ...] = ()  # (pk of who reacted, emoji)
    unsupported: bool = False

    @property
    def sent_at(self) -> datetime:
        return datetime.fromtimestamp(self.timestamp_us / 1_000_000, timezone.utc)


@dataclass
class Thread:
    id: str
    title: str | None
    is_group: bool
    people: list[Person]  # everyone but you
    archived: bool = False
    seen_us: int | None = None  # when you last saw this thread, on any device
    unread: bool = False  # Instagram's own flag, for when it gives no time
    items: list[Item] = field(default_factory=list)  # newest first, as Instagram sends them
    oldest_cursor: str | None = None
    has_older: bool = False

    def person(self, pk: str) -> Person | None:
        return next((p for p in self.people if p.pk == pk), None)


def _str(value: Any) -> str:
    return "" if value is None else str(value)


def _int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def one_line(text: str, limit: int = 160) -> str:
    """First line of text, trimmed to fit a list row, like the sync worker's oneLine."""
    line = re.sub(r"\s+", " ", text).strip()
    return line if len(line) <= limit else line[: limit - 1].rstrip() + "…"


def person(raw: dict[str, Any]) -> Person | None:
    pk = _str(raw.get("pk") or raw.get("pk_id") or raw.get("id") or raw.get("strong_id__"))
    if not pk:
        return None
    return Person(pk=pk, username=raw.get("username") or None, full_name=(raw.get("full_name") or "").strip() or None, picture=_str(raw.get("profile_pic_url")) or None)


def _best(candidates: list[dict[str, Any]] | None) -> str | None:
    """The largest version's URL."""
    found = [c for c in candidates or [] if isinstance(c, dict) and c.get("url")]
    if not found:
        return None
    return max(found, key=lambda c: _int(c.get("width")) * _int(c.get("height")))["url"]


def _photo_or_video(media: dict[str, Any] | None) -> Media | None:
    if not isinstance(media, dict):
        return None
    video = _best(media.get("video_versions"))
    if video or _int(media.get("media_type")) == 2:
        return Media(video, "Video.mp4", "video/mp4", "video") if video else None
    photo = _best((media.get("image_versions2") or {}).get("candidates"))
    return Media(photo, "Photo.jpg", "image/jpeg", "image") if photo else None


def _post_link(media: dict[str, Any] | None) -> str | None:
    """A shared post or reel as a link to it on instagram.com."""
    if not isinstance(media, dict) or not media.get("code"):
        return None
    reel = media.get("product_type") == "clips"
    return f"{SITE}/{'reel' if reel else 'p'}/{media['code']}/"


def _xma(raw: dict[str, Any], *keys: str) -> dict[str, Any] | None:
    """The first share card Instagram sent in its newer format: a list under one of these keys."""
    for key in keys:
        cards = raw.get(key)
        if isinstance(cards, list):
            for card in cards:
                if isinstance(card, dict) and card.get("target_url"):
                    return card
    return None


def _duration(ms: Any) -> str:
    seconds = round(_int(ms) / 1000)
    return f" ({seconds // 60}:{seconds % 60:02d})" if seconds else ""


def _joined(*parts: str | None) -> str:
    return "\n".join(p for p in (s.strip() for s in parts if s) if p)


def describe(raw: dict[str, Any]) -> Item | None:
    """One direct item as a message: its text, a one-line preview and at most one file. None for notices
    that are not messages, and for items without an ID."""
    item_id = _str(raw.get("item_id"))
    kind = _str(raw.get("item_type"))
    if not item_id or kind in SKIPPED:
        return None
    text = ""
    preview = ""
    media: Media | None = None
    unsupported = False

    if kind == "text":
        text = _str(raw.get("text"))
    elif kind == "link":
        link = raw.get("link") or {}
        text = _str(link.get("text")) or _str((link.get("link_context") or {}).get("link_url"))
    elif kind == "like":
        text = _str(raw.get("like")) or "❤️"
    elif kind == "media":
        media = _photo_or_video(raw.get("media"))
        preview = "Video" if media and media.kind == "video" else "Photo"
    elif kind == "raven_media":
        # Disappearing photos and videos are never saved: opening one here would count as viewing it.
        inner = (raw.get("visual_media") or {}).get("media") or {}
        preview = "Disappearing Video" if _int(inner.get("media_type")) == 2 else "Disappearing Photo"
        text = f"{preview}. Open Instagram to see it."
    elif kind == "voice_media":
        audio = (((raw.get("voice_media") or {}).get("media") or {}).get("audio")) or {}
        preview = f"Voice Note{_duration(audio.get('duration'))}"
        # The name the AI worker looks for to transcribe it, as for WhatsApp voice notes.
        media = Media(audio["audio_src"], "Voice Note.m4a", "audio/mp4", "audio") if audio.get("audio_src") else None
    elif kind == "animated_media":
        animated = raw.get("animated_media") or {}
        url = ((animated.get("images") or {}).get("fixed_height") or {}).get("url")
        preview = "Sticker" if animated.get("is_sticker") else "GIF"
        if url:
            gif = ".gif" in url.split("?")[0]
            media = Media(url, f"{preview}.{'gif' if gif else 'webp'}", "image/gif" if gif else "image/webp", "image")
    elif kind == "media_share":
        share = raw.get("media_share") or {}
        link = _post_link(share)
        preview = "Shared Reel" if share.get("product_type") == "clips" else "Shared Post"
        text = _joined(_str(raw.get("text")), link)
    elif kind == "clip":
        clip = raw.get("clip") or {}
        link = _post_link({**(clip.get("clip") or clip), "product_type": "clips"})
        preview = "Shared Reel"
        text = _joined(_str(raw.get("text")), link)
    elif kind in ("xma_clip", "xma_media_share", "xma_story_share", "generic_xma", "xma", "xma_link", "xma_profile"):
        card = _xma(raw, "xma_clip", "xma_media_share", "xma_story_share", "xma_profile", "generic_xma", "xma_link")
        preview = {"xma_clip": "Shared Reel", "xma_story_share": "Shared Story", "xma_profile": "Shared Profile"}.get(kind, "Shared Post")
        if card:
            text = _joined(_str(raw.get("text")), card.get("title_text"), card["target_url"])
        else:
            text, unsupported = UNSUPPORTED, True
    elif kind == "story_share":
        story = raw.get("story_share") or {}
        inner = story.get("media") or {}
        owner = (inner.get("user") or {}).get("username")
        story_id = _str(inner.get("pk") or inner.get("id")).split("_")[0]
        link = f"{SITE}/stories/{owner}/{story_id}/" if owner and story_id else None
        preview = "Shared Story"
        text = _joined(_str(story.get("text")), link) or _str(story.get("message")) or "This story is no longer available."
    elif kind == "reel_share":
        share = raw.get("reel_share") or {}
        reply = {"reply": "Replied to Your Story", "mention": "Mentioned You in Their Story", "reaction": "Reacted to Your Story"}
        preview = reply.get(_str(share.get("type")), "Replied to a Story")
        text = _str(share.get("text"))
    elif kind == "felix_share":
        video = (raw.get("felix_share") or {}).get("video") or {}
        preview = "Shared Video"
        text = _joined(_str(raw.get("text")), f"{SITE}/tv/{video['code']}/" if video.get("code") else None)
    elif kind == "profile":
        profile = raw.get("profile") or {}
        preview = "Shared Profile"
        text = f"{SITE}/{profile['username']}/" if profile.get("username") else UNSUPPORTED
    elif kind == "location":
        location = raw.get("location") or {}
        preview = "Location"
        text = _joined(_str(location.get("name")), _str(location.get("address")))
    elif kind == "placeholder":
        placeholder = raw.get("placeholder") or {}
        text = _str(placeholder.get("message")) or UNSUPPORTED
        unsupported = True
    else:
        text, unsupported = UNSUPPORTED, True

    if not preview:
        preview = one_line(text)
    elif kind == "reel_share" and text:
        preview = one_line(f"{preview}: {text}")

    quoted = None
    replied = raw.get("replied_to_message")
    if isinstance(replied, dict) and replied.get("item_id"):
        inner = describe(replied)
        quoted = Quoted(_str(replied["item_id"]), _str(replied.get("user_id")), one_line(inner.text, 100) if inner and inner.text else (inner.preview if inner else ""))

    reactions = tuple(
        (_str(r.get("sender_id")), _str(r.get("emoji")))
        for r in ((raw.get("reactions") or {}).get("emojis") or [])
        if isinstance(r, dict) and r.get("sender_id") and r.get("emoji")
    )
    return Item(
        id=item_id,
        sender_pk=_str(raw.get("user_id")),
        timestamp_us=_int(raw.get("timestamp")),
        type=kind,
        text=text,
        preview=preview,
        media=media,
        quoted=quoted,
        reactions=reactions,
        unsupported=unsupported,
    )


def thread(raw: dict[str, Any], viewer_pk: str) -> Thread | None:
    """A direct thread from the inbox (or one thread read on its own), with its items described."""
    thread_id = _str(raw.get("thread_id"))
    if not thread_id:
        return None
    people = [p for p in (person(u) for u in raw.get("users") or [] if isinstance(u, dict)) if p and p.pk != viewer_pk]
    seen = (raw.get("last_seen_at") or {}).get(viewer_pk) or {}
    items = [i for i in (describe(r) for r in raw.get("items") or [] if isinstance(r, dict)) if i]
    return Thread(
        id=thread_id,
        title=(raw.get("thread_title") or "").strip() or None,
        is_group=bool(raw.get("is_group")) or len(people) > 1,
        people=people,
        archived=bool(raw.get("archived")),
        seen_us=_int(seen.get("timestamp")) or None,
        unread=_int(raw.get("read_state")) == 1,
        items=sorted(items, key=lambda i: i.timestamp_us, reverse=True),
        oldest_cursor=raw.get("oldest_cursor") or None,
        has_older=bool(raw.get("has_older")),
    )


def inbox(response: dict[str, Any], viewer_pk: str) -> tuple[list[Thread], str | None]:
    """The threads of one inbox page and the cursor for the page after it."""
    box = response.get("inbox") or {}
    threads = [t for t in (thread(r, viewer_pk) for r in box.get("threads") or [] if isinstance(r, dict)) if t]
    return threads, (box.get("oldest_cursor") if box.get("has_older") else None)


def is_unread(t: Thread, item: Item, viewer_pk: str) -> bool:
    """Whether a message someone else sent is still unread: newer than when you last saw the thread, or,
    when Instagram gives no time, the newest message of a thread it marks unread."""
    if item.sender_pk == viewer_pk:
        return False
    if t.seen_us is not None:
        return item.timestamp_us > t.seen_us
    newest = next((i for i in t.items if i.sender_pk != viewer_pk), None)
    return t.unread and newest is not None and newest.id == item.id


class Sealer(Protocol):
    """How payload values are sealed and indexed for one user (store.UserSealer)."""

    def seal(self, field: str, value: str | None) -> str | None: ...
    def address(self, value: str | None) -> str | None: ...
    def address_index(self, value: str) -> str: ...
    def chat_index(self, value: str) -> str: ...


def person_json(s: Sealer, p: Person) -> dict[str, Any]:
    """A person as public.instagram_contact takes them."""
    username = (p.username or "").strip().lower() or None
    return {
        "pk": s.address(p.pk),
        "pk_index": s.address_index(p.pk),
        "username": s.address(username),
        "username_index": s.address_index(username) if username else None,
        "display_name": p.full_name,
        "handle": p.username,
    }


def payload(s: Sealer, t: Thread, item: Item, viewer_pk: str, *, live: bool, unread: bool) -> dict[str, Any]:
    """One message for public.ingest_instagram: the sync worker's WhatsApp payload, with Instagram people."""
    from_me = item.sender_pk == viewer_pk
    sender = None if from_me else (t.person(item.sender_pk) or Person(item.sender_pk))
    preview = f"{sender.name}: {item.preview}" if t.is_group and sender else item.preview
    meta: dict[str, Any] = {
        "chat": s.address(t.id),
        "from_me": from_me,
        "participant": s.address(item.sender_pk) if t.is_group and not from_me else None,
        "type": item.type,
    }
    if unread:
        meta["receipt"] = "pending"
    if item.unsupported:
        meta["unsupported"] = True
    if item.quoted:
        mine = item.quoted.sender_pk == viewer_pk
        author = t.person(item.quoted.sender_pk)
        meta["quoted"] = {
            "id": item.quoted.id,
            "from_me": mine,
            "author": "You" if mine else (author.name if author else ("Someone" if t.is_group else (t.people[0].name if t.people else "Them"))),
            "text": s.seal(QUOTE, item.quoted.text) or "",
        }
    if item.reactions:
        # Kept as the sync worker keeps WhatsApp reactions: "me", or the index of who reacted, and who that is, sealed.
        reactions: dict[str, str] = {}
        reactors: dict[str, str] = {}
        for pk, emoji in item.reactions:
            if pk == viewer_pk:
                reactions["me"] = emoji
                continue
            key = s.address_index(pk)
            reactions[key] = emoji
            reactors[key] = s.address(pk) or ""
        meta["reactions"] = reactions
        meta["reactors"] = reactors
    return {
        "provider_message_id": item.id,
        "chat_jid": s.address(t.id),
        "chat_index": s.chat_index(t.id),
        "is_group": t.is_group,
        "group_name": (t.title or ", ".join(p.name for p in t.people)) if t.is_group else None,
        "status": "archived" if t.archived and not live else "inbox",
        "resurface": live and not from_me,
        "sent_at": item.sent_at.isoformat(),
        "direction": "outbound" if from_me else "inbound",
        "is_read": not unread,
        "sender": person_json(s, sender) if sender else None,
        "sender_address": s.address(sender.pk) if sender else None,
        "sender_index": s.address_index(sender.pk) if sender else None,
        "participants": [] if t.is_group else [person_json(s, p) for p in t.people],
        "preview": s.seal(PREVIEW, one_line(preview)),
        "body_text": s.seal(BODY, item.text or None),
        "provider_meta": meta,
        "attachments": [{"filename": s.seal(FILENAME, item.media.filename), "mime_type": item.media.mime_type, "kind": item.media.kind, "size_bytes": None}] if item.media else [],
    }


def sent_item(item_id: str, viewer_pk: str, text: str) -> Item:
    """The message direct_send created, to store it at once like a WhatsApp reply. The next poll finds the
    same item and leaves it as it is."""
    now_us = int(datetime.now(timezone.utc).timestamp() * 1_000_000)
    return Item(id=item_id, sender_pk=viewer_pk, timestamp_us=now_us, type="text", text=text, preview=one_line(text))
