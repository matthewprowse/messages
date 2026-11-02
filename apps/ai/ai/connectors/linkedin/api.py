"""LinkedIn's messaging calls, the way the web app makes them (captured 29 October 2026): list and page
conversations, load messages, send, start a conversation, upload a file, mark read and search for a person.

Implements the Api in client.py on a Session, returning the helper's own shapes (mapping.py). Calls that were seen in
captured traffic say so; the ones that were not (sending into an existing conversation, uploading a document or a
video) are marked UNVERIFIED and need one live check. Every call is one attempt: nothing here retries a send."""

from __future__ import annotations

import uuid
from typing import BinaryIO, Callable, Optional

from . import mapping, queries
from .files import upload_host
from .realtime import Realtime
from .session import ORIGIN, Session, rest
from .wire import ResponseError

GRAPHQL = "/voyager/api/voyagerMessagingGraphQL/graphql"
UPLOAD_TYPES = {"image": "MESSAGING_PHOTO_ATTACHMENT", "file": "MESSAGING_FILE_ATTACHMENT", "video": "MESSAGING_VIDEO_ATTACHMENT"}  # only photo seen


class VoyagerApi:
    def __init__(self, session: Session, me: dict, sync_token: str = "") -> None:
        self.s, self.me, self.sync_token = session, me, sync_token
        self.mailbox = me.get("urn") or mapping.PROFILE_PREFIX + me.get("id", "")
        self.live: Optional[Realtime] = None

    def graphql(self, query_id: str, variables: dict) -> dict:
        return self.s.get_json(f"{GRAPHQL}?queryId={query_id}&variables={rest(variables)}").get("data") or {}

    def conversations_before(self, before_ms: int) -> list[dict]:
        d = self.graphql(queries.CONVERSATIONS_BEFORE, {"query": {"predicateUnions": [{"conversationCategoryPredicate": {"category": "PRIMARY_INBOX"}}]}, "count": 20, "mailboxUrn": self.mailbox, "lastUpdatedBefore": before_ms})
        return [mapping.conversation_from(c) for c in (d.get("messengerConversationsByCategoryQuery") or {}).get("elements") or []]

    def changes(self) -> dict:
        """What changed since the last sync token. With none yet, the first call returns the recent conversations and the token."""
        d = self.graphql(queries.CONVERSATIONS_CHANGES, {"mailboxUrn": self.mailbox, "syncToken": self.sync_token}) if self.sync_token else self.graphql(queries.CONVERSATIONS, {"mailboxUrn": self.mailbox})
        page = d.get("messengerConversationsBySyncToken") or {}
        meta = page.get("metadata") or {}
        deleted = []
        for x in meta.get("deletedUrns") or []:
            urn = x if isinstance(x, str) else (x.get("conversationUrn") or (x.get("conversation") or {}).get("entityUrn") or x.get("entityUrn") or "") if isinstance(x, dict) else ""
            if urn: deleted.append(urn)
        self.sync_token = meta.get("newSyncToken") or self.sync_token
        return {"conversations": [mapping.conversation_from(c) for c in page.get("elements") or []], "deleted": deleted, "syncToken": self.sync_token}

    def messages_before(self, conversation: str, before_ms: int, count: int) -> list[dict]:
        d = self.graphql(queries.MESSAGES_BEFORE, {"deliveredAt": before_ms, "conversationUrn": conversation, "countBefore": count, "countAfter": 0})
        return [mapping.message_from(m, conversation) for m in (d.get("messengerMessagesByAnchorTimestamp") or {}).get("elements") or []]

    def create_message(self, message: dict, extra: dict) -> dict:
        body = {"message": message, "mailboxUrn": self.mailbox, "trackingId": uuid.uuid4().hex[:16], "dedupeByClientGeneratedToken": True, **extra}
        out = self.s.post_json("/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage", body)
        return mapping.sent_from(out.get("value") or {}, self.me)

    @staticmethod
    def message_body(text: str, token: str, render: Optional[dict]) -> dict:
        m: dict = {"body": {"attributes": [], "text": text}, "originToken": token}
        if render: m["renderContentUnions"] = [render]
        return m

    def send_message(self, conversation: str, text: str, token: str, render: Optional[dict] = None) -> dict:
        # UNVERIFIED: the capture only has a first message to a person (hostRecipientUrns). Into an existing conversation
        # the web app is believed to name it as conversationUrn.
        return self.create_message(self.message_body(text, token, render), {"conversationUrn": conversation})

    def start_conversation(self, me_id: str, recipient_id: str, text: str, token: str, render: Optional[dict] = None) -> dict:
        return self.create_message(self.message_body(text, token, render), {"hostRecipientUrns": [mapping.PROFILE_PREFIX + recipient_id]})

    def upload(self, kind: str, name: str, mime: str, size: int, data: BinaryIO) -> dict:
        """Asks LinkedIn for an upload address, sends the bytes there, and returns the render content that attaches the file.
        UNVERIFIED for documents and video: only a photo upload was captured, and a large file may be uploaded in parts."""
        meta = self.s.post_json("/voyager/api/voyagerVideoDashMediaUploadMetadata?action=upload", {"mediaUploadType": UPLOAD_TYPES.get(kind, UPLOAD_TYPES["file"]), "fileSize": size, "filename": name}, accept="application/vnd.linkedin.normalized+json+2.1", content_type="application/json; charset=utf-8")
        v = (meta.get("data") or {}).get("value") or meta.get("value") or {}
        if v.get("type") != "SINGLE" or not v.get("singleUploadUrl") or not v.get("urn"): raise ResponseError(501)  # a multi-part upload is not supported
        if not upload_host(v["singleUploadUrl"]): raise ResponseError(502)  # the cookies and csrf token go only to LinkedIn
        headers = self.s.headers("application/json", mime, {k: str(x) for k, x in (v.get("singleUploadHeaders") or {}).items()})
        self.s.request("PUT", v["singleUploadUrl"], headers, data.read(), timeout=300)
        return {"file": {"assetUrn": v["urn"], "byteSize": size, "mediaType": mime, "name": name}}

    def search(self, name: str) -> list[dict]:
        d = self.s.get_json("/voyager/api/graphql?includeWebMetadata=true&variables=" + rest({"keyword": name, "types": list(queries.TYPEAHEAD_TYPES)}) + "&queryId=" + queries.TYPEAHEAD, "application/vnd.linkedin.normalized+json+2.1")
        els = (((d.get("data") or {}).get("data") or {}).get("messagingDashMessagingTypeaheadByTypeaheadKeyword") or {}).get("elements") or []
        return mapping.people_from_typeahead(els)

    def mark_read(self, conversation: str) -> None:
        out = self.s.post_json("/voyager/api/voyagerMessagingDashMessengerConversations?ids=" + rest([conversation]), {"entities": {conversation: {"patch": {"$set": {"read": True}}}}})
        status = ((out.get("results") or {}).get(conversation) or {}).get("status")
        if out.get("errors") or (status and status >= 300): raise ResponseError(int(status or 500))

    def connect(self, on_event: Callable[[dict], None]) -> None:
        if self.live is None: self.live = Realtime(self.s, on_event); self.live.start()

    def close(self) -> None:
        if self.live is not None: self.live.stop(); self.live = None
