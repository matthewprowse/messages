"""Turns LinkedIn's messaging JSON into the helper's own shapes (Person, Message, Conversation: see
apps/linkedin/README.md). Pure: no network. Written against responses captured from the web app on 29 October
2026, and tolerant of fields that are missing or null, since LinkedIn leaves many out."""

from __future__ import annotations

from typing import Any, Optional

PARTICIPANT_PREFIX = "urn:li:msg_messagingParticipant:"
PROFILE_PREFIX = "urn:li:fsd_profile:"


def text_of(v: Any) -> str:
    """The text of a {text, attributes} value, or "" for anything else."""
    return (v.get("text") or "").strip() if isinstance(v, dict) and isinstance(v.get("text"), str) else ""


def urn_id(urn: Any) -> str:
    """The last part of a URN, which is a profile's or company's ID."""
    return urn.rsplit(":", 1)[-1].rstrip(")") if isinstance(urn, str) and ":" in urn else ""


def picture_url(img: Any) -> str:
    """The address of the largest version of an image (profile picture or logo), or "" when there is none."""
    if not isinstance(img, dict) or not img.get("rootUrl"): return ""
    arts = [a for a in img.get("artifacts") or [] if isinstance(a, dict) and a.get("fileIdentifyingUrlPathSegment")]
    if not arts: return ""
    return img["rootUrl"] + max(arts, key=lambda a: (a.get("width") or 0) * (a.get("height") or 0))["fileIdentifyingUrlPathSegment"]


def person_from(p: Any) -> Optional[dict]:
    """A messaging participant as a Person, or None when it names nobody."""
    if not isinstance(p, dict): return None
    pid = urn_id(p.get("entityUrn"))
    if not pid: return None
    kind = p.get("participantType") if isinstance(p.get("participantType"), dict) else {}
    org = kind.get("organization")
    if isinstance(org, dict):
        out = {"id": pid, "urn": str(p["entityUrn"]).removeprefix(PARTICIPANT_PREFIX), "kind": "organization"}
        for k, v in (("name", text_of(org.get("name"))), ("picture", picture_url(org.get("logo")))):
            if v: out[k] = v
        return out
    out = {"id": pid, "urn": PROFILE_PREFIX + pid, "kind": "member"}
    m = kind.get("member")
    if isinstance(m, dict):
        for k, v in (("firstName", text_of(m.get("firstName"))), ("lastName", text_of(m.get("lastName"))), ("headline", text_of(m.get("headline"))), ("picture", picture_url(m.get("profilePicture")))):
            if v: out[k] = v
    return out


def files_from(contents: Any) -> list[dict]:
    """The attachments of a message, by name, type and size. Their bytes are not fetched. Only `file` and
    `vectorImage` have been seen in captured traffic; the rest are by their names in LinkedIn's data."""
    files = []
    for c in contents or []:
        if not isinstance(c, dict): continue
        f = c.get("file")
        if isinstance(f, dict) and f.get("name"):
            files.append({k: v for k, v in (("name", f["name"]), ("mediaType", f.get("mediaType") or "application/octet-stream"), ("size", f.get("byteSize"))) if v})
        elif c.get("vectorImage"): files.append({"name": "Photo.jpg", "mediaType": "image/jpeg"})
        elif c.get("video"): files.append({"name": "Video.mp4", "mediaType": "video/mp4"})
        elif c.get("audio"): files.append({"name": "Voice Note.m4a", "mediaType": "audio/mp4"})
        elif isinstance(c.get("externalMedia"), dict): files.append({"name": text_of(c["externalMedia"].get("title")) or "GIF", "mediaType": "image/gif"})
    return files


def message_from(m: dict, conversation_urn: str = "") -> dict:
    """A message as a Message. conversation_urn fills in for a message that does not say which conversation it is in."""
    conv = m.get("conversation") if isinstance(m.get("conversation"), dict) else {}
    contents = m.get("renderContent") or m.get("renderContentUnions") or []
    out = {"urn": m.get("entityUrn") or "", "conversationUrn": conv.get("entityUrn") or m.get("conversationUrn") or conversation_urn, "deliveredAt": int(m.get("deliveredAt") or 0), "text": (m.get("body") or {}).get("text") or ""}
    if not out["text"]:  # a forwarded message carries its words in the forward
        for c in contents:
            fwd = c.get("forwardedMessage") if isinstance(c, dict) else None
            if isinstance(fwd, dict) and (fwd.get("forwardedBody") or {}).get("text"): out["text"] = fwd["forwardedBody"]["text"]; break
    sender = person_from(m.get("sender") or m.get("actor"))
    if sender: out["sender"] = sender
    if m.get("messageBodyRenderFormat"): out["format"] = m["messageBodyRenderFormat"]
    files = files_from(contents)
    if files: out["files"] = files
    return out


def conversation_from(c: dict) -> dict:
    """A conversation as a Conversation, with the participants (you included) and the messages LinkedIn sent with it."""
    urn = c.get("entityUrn") or ""
    out: dict = {"urn": urn, "group": bool(c.get("groupChat")), "read": bool(c.get("read")), "lastActivityAt": int(c.get("lastActivityAt") or 0), "participants": [p for p in map(person_from, c.get("conversationParticipants") or []) if p]}
    if (c.get("title") or "").strip(): out["title"] = c["title"].strip()
    if c.get("lastReadAt"): out["lastReadAt"] = int(c["lastReadAt"])
    if c.get("categories"): out["categories"] = list(c["categories"])
    msgs = [message_from(m, urn) for m in ((c.get("messages") or {}).get("elements") or []) if isinstance(m, dict)]
    if msgs: out["messages"] = msgs
    return out


def me_from(profile: dict) -> dict:
    """You, from /voyager/api/me (a normalized response: the mini profile is in `included`)."""
    mini = next((x for x in profile.get("included") or [] if isinstance(x, dict) and "miniProfile" in str(x.get("entityUrn", "")) and "firstName" in x), None)
    if not mini: return {}
    pid = urn_id(mini["entityUrn"])
    return {"id": pid, "urn": PROFILE_PREFIX + pid, "kind": "member", "firstName": (mini.get("firstName") or "").strip(), "lastName": (mini.get("lastName") or "").strip()}


def sent_from(value: dict, me: dict) -> dict:
    """The answer to createMessage as a Message. Its sender is you."""
    m = message_from({**value, "conversation": {"entityUrn": value.get("conversationUrn") or value.get("backendConversationUrn") or ""}})
    if me: m["sender"] = me
    return m


def people_from_typeahead(elements: list) -> list[dict]:
    """People from a messaging typeahead: {'id', 'firstName', 'lastName'}. The result gives one display name, so
    the first word is the first name; names are compared whole, so where the split falls does not matter."""
    out = []
    for e in elements or []:
        tv = (e or {}).get("targetEntityViewModel") or {}
        urn = (tv.get("entity") or {}).get("*profile") or ""
        pid = urn_id(urn) if str(urn).startswith(PROFILE_PREFIX) else ""
        name = text_of(tv.get("title"))
        if pid and name:
            first, _, last = name.partition(" ")
            out.append({"id": pid, "firstName": first, "lastName": last})
    return out


def events_from(decorated: dict) -> list[dict]:
    """Helper events from a real-time DecoratedEvent: a message, or a conversation. Anything else (typing, badge
    counts, reactions) is dropped. Not yet checked against a captured message event: it looks for the same objects the
    list calls return, by their URN kind, wherever they sit in the payload."""
    found: list[dict] = []

    def walk(v: Any, depth: int = 0) -> None:
        if depth > 8: return
        if isinstance(v, dict):
            urn = v.get("entityUrn")
            if isinstance(urn, str) and urn.startswith("urn:li:msg_message:") and "body" in v: found.append({"event": "message", "message": message_from(v)}); return
            if isinstance(urn, str) and urn.startswith("urn:li:msg_conversation:") and "conversationParticipants" in v: found.append({"event": "conversation", "conversation": conversation_from(v)}); return
            for x in v.values(): walk(x, depth + 1)
        elif isinstance(v, list):
            for x in v: walk(x, depth + 1)

    walk((decorated.get("payload") or {}).get("data"))
    return found
