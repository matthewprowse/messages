"""WhatsApp voice notes as text. Each voice note the sync worker has saved is sent to Gemini once and what
was said is stored encrypted in messages.transcript, for View Transcript in the app, for triage (and so
the conversation's summary and the daily brief), and for drafting replies.

Newest first, a few at a time. A voice note that cannot be done is tried again after a pause, and given
up on ('failed') after a few tries. Only counts are logged, never what was said."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .fields import TRANSCRIPT
from .gemini import Gemini, GeminiError, UsageContext
from .supabase import Supabase, SupabaseError
from .text import UNTRUSTED
from .triage import LOOKBACK_DAYS
from .vault import Vault

BUCKET = "attachments"
BATCH = 5
MAX_BYTES = 15 * 1024 * 1024  # Gemini takes up to 20MB inline; a voice note is far smaller
MAX_TRIES = 3
RETRY_S = 300

SYSTEM = """You transcribe WhatsApp voice notes.

Write down exactly what is said, in the language it is said in. People may speak South African English,
Afrikaans, isiZulu, isiXhosa or another language, or mix them in one sentence: keep it as spoken and do
not translate. Add punctuation and break it into paragraphs where the speaker pauses or changes topic.
Leave out filler sounds (um, uh) but keep every word that carries meaning, including names, numbers,
times, prices and addresses. Do not summarise, explain or add anything.

speech: false when no words can be made out (silence, noise, a pocket recording); transcript is then empty.
language: the main language spoken, in English, such as "English" or "Afrikaans".""" + UNTRUSTED

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "speech": {"type": "boolean"},
        "transcript": {"type": "string"},
        "language": {"type": "string"},
    },
    "required": ["speech", "transcript", "language"],
}


def pending_query(skip: list[str]) -> dict[str, str]:
    """Saved voice notes whose message has no transcript yet, newest first."""
    params = {
        "select": "id,storage_path,mime_type,size_bytes,messages!inner(id,user_id,account_id,thread_id,sent_at,transcript_status)",
        "filename": "like.Voice Note.*",
        "storage_path": "not.is.null",
        "messages.transcript_status": "is.null",
        "order": "created_at.desc",
        "limit": str(BATCH),
    }
    if skip:
        params["messages.id"] = "not.in.(" + ",".join(skip) + ")"
    return params


def recent(sent_at: Any) -> bool:
    """Within the window triage looks at, so a cleared triage is done again."""
    try:
        sent = datetime.fromisoformat(str(sent_at).replace("Z", "+00:00"))
    except ValueError:
        return False
    return datetime.now(timezone.utc) - sent < timedelta(days=LOOKBACK_DAYS)


def audio_type(mime: str | None) -> str:
    """The type Gemini is told: WhatsApp's "audio/ogg; codecs=opus" without its parameters."""
    return (mime or "audio/ogg").split(";")[0].strip() or "audio/ogg"


class Transcribe:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault or Vault(db)
        self._tries: dict[str, tuple[int, float]] = {}  # message id -> (failed tries, monotonic time to try again)

    def waiting(self) -> list[str]:
        """Messages taking a break after failing."""
        now = time.monotonic()
        return [mid for mid, (_, at) in self._tries.items() if at > now]

    def run_once(self) -> int:
        rows = self.db.select("attachments", pending_query(self.waiting()))
        done = 0
        for a in rows:
            m = a["messages"]
            try:
                done += self._one(a, m)
            except (GeminiError, SupabaseError, OSError) as err:
                self._failed(m, err)
        if done:
            log.info("voice notes transcribed", count=done)
        return done

    def _one(self, a: dict[str, Any], m: dict[str, Any]) -> int:
        if (a.get("size_bytes") or 0) > MAX_BYTES:
            self._save(m["id"], None, "failed")
            return 0
        audio = self.db.download(BUCKET, a["storage_path"])
        if len(audio) > MAX_BYTES:
            self._save(m["id"], None, "failed")
            return 0
        result = self.gemini.json(
            self.model,
            SYSTEM,
            "Transcribe this voice note.",
            SCHEMA,
            UsageContext(m["user_id"], "transcribe", m.get("account_id"), m.get("thread_id")),
            temperature=0.0,
            thinking="low",
            audio=(audio, audio_type(a.get("mime_type"))),
            timeout=120,
        )
        text = str(result.get("transcript") or "").strip()
        if not result.get("speech") or not text:
            self._save(m["id"], None, "silent")
            return 1
        self._save(m["id"], self.vault.seal(m["user_id"], TRANSCRIPT, text), "done")
        self._tries.pop(m["id"], None)
        if recent(m.get("sent_at")):
            # Triaged before it could be heard (its file came late, or before transcripts existed): triaged
            # again with what was said, so its summary, the daily brief and its reply choices know it.
            self.db.delete("message_ai", {"message_id": f"eq.{m['id']}"})
        return 1

    def _save(self, message_id: str, transcript: str | None, status: str) -> None:
        self.db.update("messages", {"id": f"eq.{message_id}"}, {"transcript": transcript, "transcript_status": status}, minimal=True)

    def _failed(self, m: dict[str, Any], err: Exception) -> None:
        tries = self._tries.get(m["id"], (0, 0.0))[0] + 1
        log.warn("voice note not transcribed", message=m["id"], tries=tries, code=getattr(err, "status", None) or type(err).__name__)
        if tries >= MAX_TRIES:
            self._save(m["id"], None, "failed")
            self._tries.pop(m["id"], None)
        else:
            self._tries[m["id"]] = (tries, time.monotonic() + RETRY_S)
