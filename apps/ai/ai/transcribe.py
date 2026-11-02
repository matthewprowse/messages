"""WhatsApp voice notes as text. Each voice note the sync worker has saved is sent to Gemini once and what
was said is stored encrypted in messages.transcript, for View Transcript in the app, for triage (and so
the conversation's summary and the daily brief), and for drafting replies.

Newest first, a few at a time. A voice note that cannot be done is tried again after a pause, and given
up on ('failed') after a few tries. Only counts are logged, never what was said."""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .crypto import is_ciphertext
from .fields import ATTACHMENT_DATA, FILENAME, TRANSCRIPT
from .billing import is_billing_paused
from .gemini import Gemini, GeminiError, UsageContext
from .supabase import Supabase
from .text import UNTRUSTED
from .triage import LOOKBACK_DAYS
from .vault import Vault

BUCKET = "attachments"
BATCH = 5
MAX_BYTES = 15 * 1024 * 1024  # Gemini takes up to 20MB inline; a voice note is far smaller
MAX_TRIES = 3
RETRY_S = 300
DEFAULT_MAX_SECONDS = 300  # a voice note longer than this is not transcribed (VOICE_NOTE_MAX_SECONDS)
BYTES_PER_SECOND = 16_000  # 128 kbit/s, above voice notes' usual bitrate: a file this size per second cannot be shorter than it looks


def max_seconds() -> int:
    try:
        value = int(os.environ.get("VOICE_NOTE_MAX_SECONDS", "") or DEFAULT_MAX_SECONDS)
    except ValueError:
        return DEFAULT_MAX_SECONDS
    return value if value > 0 else DEFAULT_MAX_SECONDS


def ogg_seconds(audio: bytes) -> float | None:
    """The length of an Ogg Opus file (WhatsApp voice notes), from the last page's granule position at 48 kHz."""
    at = audio.rfind(b"OggS")
    if at < 0 or len(audio) < at + 14:
        return None
    granule = int.from_bytes(audio[at + 6 : at + 14], "little", signed=True)
    return granule / 48000 if granule > 0 else None


def note_seconds(audio: bytes | None, known: Any = None, size: Any = None) -> float | None:
    """How long a voice note is: as stored when the row says (duration_s), else read from the file, else a floor
    from its size (what its length would be at the highest usual bitrate). None when nothing is known."""
    if isinstance(known, (int, float)) and not isinstance(known, bool) and known > 0:
        return float(known)
    if audio:
        got = ogg_seconds(audio)
        if got:
            return got
        size = len(audio)
    if isinstance(size, (int, float)) and not isinstance(size, bool) and size > 0:
        return size / BYTES_PER_SECOND
    return None

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


FETCH = 20  # audio rows read per pass: the name is sealed, so voice notes are told from other audio here, not in SQL


def pending_query(skip: list[str], skip_files: list[str] | None = None) -> dict[str, str]:
    """Saved audio whose message has no transcript yet, newest first. Which of it is a voice note is decided
    after the name is opened (attachments.filename is sealed); skip_files leaves out audio already seen not to be."""
    params = {
        "select": "id,filename,storage_path,mime_type,size_bytes,messages!inner(id,user_id,account_id,thread_id,sent_at,transcript_status)",
        "kind": "eq.audio",
        "storage_path": "not.is.null",
        "messages.transcript_status": "is.null",
        "order": "created_at.desc",
        "limit": str(FETCH),
    }
    if skip:
        params["messages.id"] = "not.in.(" + ",".join(skip) + ")"
    if skip_files:
        params["id"] = "not.in.(" + ",".join(skip_files) + ")"
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
        self._other_audio: set[str] = set()  # attachment ids of audio that is not a voice note
        self._tries: dict[str, tuple[int, float]] = {}  # message id -> (failed tries, monotonic time to try again)

    def waiting(self) -> list[str]:
        """Messages taking a break after failing."""
        now = time.monotonic()
        return [mid for mid, (_, at) in self._tries.items() if at > now]

    claims = None  # a claims.Claims, set by the entry point: the second-worker guard

    def run_once(self) -> int:
        rows = self.db.select("attachments", pending_query(self.waiting(), sorted(self._other_audio)[-500:]))
        done = 0
        taken = 0
        for a in rows:
            m = a["messages"]
            if not self.is_voice_note(m["user_id"], a.get("filename")):
                if not is_ciphertext(a.get("filename")):  # a name that could not be opened (no key yet) is looked at again
                    self._other_audio.add(a["id"])
                continue
            if taken >= BATCH:
                break
            if self.claims and not self.claims.claim("transcribe", [a["id"]]):  # another AI worker has this note
                continue
            taken += 1
            try:
                done += self._one(a, m)
            except Exception as err:  # any one note (a cut-off download, a bad key, a malformed answer) must not stop the rest or go untried
                self._failed(m, err)
            finally:
                if self.claims:
                    self.claims.release("transcribe", [a["id"]])
        if done:
            log.info("voice notes transcribed", count=done)
        return done

    def is_voice_note(self, user_id: str, filename: Any) -> bool:
        return str(self.vault.open(user_id, FILENAME, filename) or "").startswith("Voice Note.")

    def _one(self, a: dict[str, Any], m: dict[str, Any]) -> int:
        limit = max_seconds()
        # Checked before the download, from the stored length or size; again once the file is read.
        if (a.get("size_bytes") or 0) > MAX_BYTES or (note_seconds(None, a.get("duration_s"), a.get("size_bytes")) or 0) > limit:
            self._save(m["id"], None, "failed")
            return 0
        if self.gemini.billing_blocked():  # no point downloading a file for a call the breaker will refuse
            raise GeminiError(None, "billing_paused")
        audio = self.db.download(BUCKET, a["storage_path"])
        # Sealed by the sync worker ("e1b:" header), opened here in memory; a plain legacy file passes through.
        opened = self.vault.open_bytes(m["user_id"], ATTACHMENT_DATA, audio)
        if opened is None:
            raise OSError("voice note could not be opened")
        audio = opened
        seconds = note_seconds(audio, a.get("duration_s"))
        if len(audio) > MAX_BYTES or (seconds or 0) > limit:
            self._save(m["id"], None, "failed")
            return 0
        result = self.gemini.json(
            self.model,
            SYSTEM,
            "Transcribe this voice note.",
            SCHEMA,
            UsageContext(m["user_id"], "transcribe", m.get("account_id"), m.get("thread_id")),
            temperature=0.0,
            thinking="minimal",  # mechanical; falls back to low in gemini.py on a model that has no minimal
            attempts=2,  # a slow day must not bill a big audio file four times
            audio=(audio, audio_type(a.get("mime_type"))),
            audio_seconds=seconds,
            max_output=8192,
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
        if isinstance(err, GeminiError) and ("budget_" in str(err) or is_billing_paused(err)):
            # The share is used up (or could not be read), or billing is paused: not this note's fault, so it is not a try. Wait and look again.
            self._tries[m["id"]] = (self._tries.get(m["id"], (0, 0.0))[0], time.monotonic() + RETRY_S)
            log.info("voice note waiting on the allowance", message=m["id"])
            return
        tries = self._tries.get(m["id"], (0, 0.0))[0] + 1
        log.warn("voice note not transcribed", message=m["id"], tries=tries, code=getattr(err, "status", None) or type(err).__name__)
        self._tries[m["id"]] = (tries, time.monotonic() + RETRY_S)  # recorded first: if the save below fails it is still a try
        if tries >= MAX_TRIES:
            try:
                self._save(m["id"], None, "failed")
                self._tries.pop(m["id"], None)
            except Exception as save_err:
                log.warn("voice note failure not saved", message=m["id"], code=log.code_of(save_err))
