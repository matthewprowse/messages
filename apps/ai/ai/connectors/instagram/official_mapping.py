"""Instagram's official API JSON (conversations and their messages, graph.py) turned into the same Thread and
Item mapping.py builds from the private API, so one payload() stores both. Pure, and tolerant: a field Meta
does not send, or sends in another shape, loses that message's file or quote but never stops a poll.

The message shape follows Meta's Message and Conversation references: from {id, username}, to {data: [...]},
message, attachments {data: [{image_data, video_data, file_url}]}, shares {data: [...]}, story, reply_to,
is_unsupported. Nothing here logs or keeps content."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Any

from .mapping import UNSUPPORTED, Item, Media, Person, Quoted, Thread, _joined, one_line

# What a poll asks of every message. Only fields in Meta's Message reference, and the shortest list that still
# works when Instagram refuses one of them (graph error 100), so a missing field cannot stop the sync.
FIELDS = "id,created_time,from,to,message,attachments,shares,story,reply_to,is_unsupported"
FALLBACK_FIELDS = "id,created_time,from,to,message"

AUDIO_EXTENSIONS = (".m4a", ".aac", ".mp3", ".wav", ".ogg")
SHARE_KINDS = {"reel": "Shared Reel", "ig_reel": "Shared Reel", "post": "Shared Post", "ig_post": "Shared Post"}


def _str(value: Any) -> str:
    return "" if value is None else str(value)


def _list(value: Any) -> list[dict[str, Any]]:
    """Meta wraps lists as {"data": [...]}; a plain list is taken too."""
    if isinstance(value, dict):
        value = value.get("data")
    return [v for v in value or [] if isinstance(v, dict)] if isinstance(value, list) else []


def time_us(value: Any) -> int:
    """A Meta time in microseconds: ISO 8601 ("2026-10-26T10:00:00+0000") or a UNIX time in seconds or milliseconds. 0 when unreadable."""
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.strip().isdigit()):
        n = float(value)
        return int(n * 1_000_000 if n < 1e11 else n * 1000 if n < 1e14 else n)
    text = _str(value).strip()
    for pattern in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z"):
        try:
            return int(datetime.strptime(text, pattern).timestamp() * 1_000_000)
        except ValueError:
            continue
    return 0


def _file(attachment: dict[str, Any]) -> tuple[Media | None, str, bool]:
    """An attachment as (file to save, preview, unsupported)."""
    image = attachment.get("image_data") if isinstance(attachment.get("image_data"), dict) else {}
    video = attachment.get("video_data") if isinstance(attachment.get("video_data"), dict) else {}
    if video.get("url"):
        return Media(video["url"], "Video.mp4", "video/mp4", "video"), "Video", False
    if image.get("animated_gif_url"):
        return Media(image["animated_gif_url"], "GIF.gif", "image/gif", "image"), "GIF", False
    if image.get("url"):
        sticker = bool(image.get("render_as_sticker"))
        return Media(image["url"], "Sticker.jpg" if sticker else "Photo.jpg", "image/jpeg", "image"), "Sticker" if sticker else "Photo", False
    url = _str(attachment.get("file_url"))
    if url:
        path = url.split("?")[0].lower()
        if path.endswith(AUDIO_EXTENSIONS):
            # The name the AI worker looks for to transcribe it, as for WhatsApp voice notes.
            return Media(url, "Voice Note.m4a", "audio/mp4", "audio"), "Voice Note", False
        if path.endswith(".mp4"):
            return Media(url, "Video.mp4", "video/mp4", "video"), "Video", False
    return None, "", True


def describe(raw: dict[str, Any]) -> Item | None:
    """One message as an Item. None for messages without an ID."""
    item_id = _str(raw.get("id"))
    if not item_id:
        return None
    sender = raw.get("from") if isinstance(raw.get("from"), dict) else {}
    text = _str(raw.get("message"))
    preview = ""
    media: Media | None = None
    unsupported = bool(raw.get("is_unsupported"))
    kind = "text"

    attachments = _list(raw.get("attachments"))
    if attachments:
        media, preview, unsupported_file = _file(attachments[0])
        kind = media.kind if media else "unsupported"
        unsupported = unsupported or (unsupported_file and not text)
        if unsupported_file and not text:
            text = UNSUPPORTED

    shares = _list(raw.get("shares"))
    if shares:
        share = shares[0]
        preview = SHARE_KINDS.get(_str(share.get("type")).lower(), "Shared Post")
        text = _joined(text, _str(share.get("url") or share.get("link")))
        kind = "share"

    story = raw.get("story")
    story = story[0] if isinstance(story, list) and story and isinstance(story[0], dict) else story
    if isinstance(story, dict):
        mention = story.get("mention") if isinstance(story.get("mention"), dict) else None
        replied = story.get("reply_to") if isinstance(story.get("reply_to"), dict) else None
        link = _str((mention or replied or story).get("link"))
        preview = "Mentioned You in Their Story" if mention else "Replied to a Story"
        if text:
            preview = one_line(f"{preview}: {text}")
        text = _joined(text, link)
        kind = "story"

    if unsupported and not text:
        text = UNSUPPORTED
    if not preview:
        preview = one_line(text)

    quoted = None
    reply = raw.get("reply_to")
    if isinstance(reply, dict):
        mid = _str(reply.get("mid") or reply.get("id"))
        if mid:
            quoted = Quoted(mid, "", "")
    return Item(
        id=item_id,
        sender_pk=_str(sender.get("id")),
        timestamp_us=time_us(raw.get("created_time")),
        type=kind,
        text=text,
        preview=preview,
        media=media,
        quoted=quoted,
        unsupported=unsupported,
    )


def with_quotes(items: list[Item]) -> list[Item]:
    """Each reply points at its message when that message is in the same batch; otherwise the quote is dropped,
    since Instagram only returns the 20 newest and a quote with no text would show as an empty box."""
    by_id = {i.id: i for i in items}
    out: list[Item] = []
    for i in items:
        if i.quoted:
            original = by_id.get(i.quoted.id)
            if original and (original.text or original.preview):
                i = replace(i, quoted=Quoted(original.id, original.sender_pk, one_line(original.text, 100) if original.text else original.preview))
            else:
                i = replace(i, quoted=None)
        out.append(i)
    return out


def people(conversation: dict[str, Any], viewer_id: str) -> list[Person]:
    """Everyone in a conversation but you, from its participants."""
    found = [p for p in _list(conversation.get("participants")) if _str(p.get("id")) and _str(p.get("id")) != viewer_id]
    return [Person(pk=_str(p["id"]), username=_str(p.get("username")) or None, full_name=_str(p.get("name")).strip() or None) for p in found]


def thread(conversation: dict[str, Any], messages: dict[str, Any], viewer_id: str) -> Thread | None:
    """A conversation with its messages as a Thread, newest first."""
    conversation_id = _str(conversation.get("id"))
    if not conversation_id:
        return None
    others = people(conversation, viewer_id)
    if not others:
        # The participants field was empty: the other side is whoever wrote the messages.
        senders = {_str((m.get("from") or {}).get("id")): m.get("from") or {} for m in _list(messages.get("messages")) if _str((m.get("from") or {}).get("id")) not in ("", viewer_id)}
        others = [Person(pk=pk, username=_str(f.get("username")) or None) for pk, f in senders.items()]
    items = [i for i in (describe(m) for m in _list(messages.get("messages"))) if i and i.timestamp_us]
    items = with_quotes(sorted(items, key=lambda i: i.timestamp_us, reverse=True))
    return Thread(id=conversation_id, title=None, is_group=False, people=others, items=items)
