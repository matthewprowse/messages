"""The spoken daily brief: today's calendar, tasks due today or overdue, and the conversations waiting on you,
as a short script read aloud by Gemini, for listening on the move.

One brief per user per local day (public.briefs). It is written at profiles.briefing_time in their time
zone, or straight away when the app asks for one (a 'pending' row, also how Refresh works). The script
comes from the same labels the Summary page uses: needs a reply, urgent or important, and FYI or work
updates from the last day, with each conversation's one-line summary. Nothing is read from message
bodies. Tasks (Microsoft To Do, Google Tasks, iCloud Reminders) are open ones due today or before, by title
only: their notes and list names are never read. The script and the audio are encrypted (field "brief"); briefs older than KEEP_DAYS are deleted,
as the audio is large.

Each audio part is a file in the private "brief-audio" bucket at "<user id>/<brief id>/<seq>.wav" (the
base64 WAV, sealed), named by brief_parts.audio_path. Storage does not follow a deleted row, so this
worker removes a brief's files itself whenever it deletes or speaks the brief again.

The audio is spoken only when someone listens, as speech is nearly all of what a brief costs. The brief
written each morning is a script alone ('written'). Listen asks for it to be spoken ('speak_pending',
set by the app) and a brief the app asked for ('pending') is written and spoken in one go.

The audio is spoken in parts (public.brief_parts) so the app can start playing within seconds: the first
part is a sentence or two and is spoken first, then the rest are spoken at the same time and stored as
each is ready. The brief is 'speaking' while parts are still coming and 'ready' once all are stored.
The voice is the user's choice (profiles.brief_voice); the speed is applied by the app as it plays
(profiles.brief_speed).

Runs in its own thread, as writing and speaking a brief takes up to a minute and triage should not wait
on it."""

from __future__ import annotations

import base64
import io
import re
import sys
import time
import wave
from array import array
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import log
from .fields import BRIEF, EVENT_LOCATION, EVENT_TITLE, NAME, SUMMARY, TASK_TITLE
from .gemini import Gemini, GeminiError, UsageContext
from .supabase import Supabase, in_list
from .text import UNTRUSTED
from .vault import Vault

POLL_S = 10  # while briefs are being made or asked for
IDLE_S = 15  # the longest wait between looks when nothing has been asked for or is due (poll.Backoff)
PROFILES_TTL_S = 300  # briefing times and time zones are read this often, not on every look
SCRIPT_MAX_OUTPUT = 6144  # tokens, thinking included: a spoken brief is a few minutes of text
AUDIO_BUCKET = "brief-audio"
AUDIO_EXT = "wav"
PRUNE_BATCH = 200
KEEP_DAYS = 7
STALE_AFTER = timedelta(minutes=10)  # a brief still 'working' this long was cut off (a restart) and is failed
REPLY_DAYS = 14  # the same windows as the Summary page (apps/web/lib/summary.ts)
PRIORITY_DAYS = 7
UPDATE_HOURS = 24
MAX_ITEMS = 8  # conversations per section in the prompt
MAX_TASKS = 8  # tasks per section in the prompt; the rest are counted
DEFAULT_ZONE = "Africa/Johannesburg"
VOICES = {"Kore", "Aoede", "Sulafat", "Charon", "Achird", "Iapetus"}  # profiles.brief_voice allows these
# Each part is spoken on its own, so every boundary is a place the voice can change tone. Parts grow: the
# first is short so the first words are heard soon, and each later one is ready long before the one
# playing ends, so there are few boundaries without a wait at any of them.
PART_WORDS_BY_SEQ = (40, 80, 160)
FIRST_PART_WORDS = PART_WORDS_BY_SEQ[0]
PART_WORDS = PART_WORDS_BY_SEQ[-1]
# Said to the speech model with every part, so all of them sound like one brief read in one go.
READ_AS = "Read this aloud in a warm, steady, conversational tone, as one part of a single continuous morning briefing:"
# Silence the speech model leaves at each end of a part, kept short so parts follow on like sentences.
KEEP_LEAD_MS = 40
KEEP_TAIL_MS = 260
SILENCE = 500  # 16-bit sample level under which a part's ends count as silent
SPEAKERS = 4  # parts spoken at once

SCHEMA = {
    "type": "object",
    "properties": {"script": {"type": "string", "description": "The brief, ready to be read aloud."}},
    "required": ["script"],
}

SYSTEM = """You write a short spoken morning brief for one busy professional. A voice reads it aloud, often
while they drive, so it must sound natural when heard, not read.

- 80 to 160 words, about a minute when heard. Plain sentences only: no lists, headings, bullet
  points, emojis, links, email addresses or phone numbers. Never use em dashes.
- Open with a short greeting that suits the time given (good morning, good afternoon or good evening),
  by first name when given. Do not add the day or small talk. Then their calendar in time order, then
  who is waiting on a reply (most pressing first), then their tasks, then anything else that needs them,
  then one short closing line.
- Each conversation gets one sentence that names who it is from and what they want or what is needed
  from you, so it makes sense heard once: "Sam Naidoo wants the lease signed", not "there is a message
  about the lease". Put the most pressing first and cover at most three waiting on a reply and two
  other conversations. Group the rest as "and two more" only when it helps.
- Say how long a deadline leaves them ("by Friday", "within four days"), counting from the time the
  message arrived when the summary gives a length of time. Never say "urgent" or "important", and
  never repeat a label: the order already says it.
- Tasks get one or two sentences: overdue ones first, then what is due today, naming at most three by
  their title in plain words and counting the rest ("and four more"). Say a task is overdue, never how
  many days late unless it is a week or more. With no tasks, say nothing about tasks.
- Updates are optional. Mention one only if it is clearly worth knowing, never just to fill space.
- Say times the way people speak them ("half past nine", "three in the afternoon"), never "15:00".
- Speak to them as "you". Never say their own name except a first-name greeting: when a summary
  names them (often by full name), say "you" instead.
- Use only the facts given. Do not invent people, times, places or requests, and do not add
  conclusions the summary does not state. If you cannot say who a conversation is from and what it
  is about in plain words, leave it out.
- With a clear calendar, say so in one short clause. When there is nothing on at all, say so in a
  sentence or two and keep it short.""" + UNTRUSTED

# The speech model reads any style direction in its prompt aloud now and then, and it does not take a
# system instruction, so it gets the script alone. The pace is set by the app's playback speed.


def zone_of(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_ZONE)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_ZONE)


def due_today(now: datetime, zone: ZoneInfo, briefing_time: str | None) -> date | None:
    """Their local date when it is past their briefing time there, else None."""
    local = now.astimezone(zone)
    try:
        at = dtime.fromisoformat((briefing_time or "07:00")[:8])
    except ValueError:
        at = dtime(7, 0)
    return local.date() if local.time() >= at else None


def split_parts(script: str) -> list[str]:
    """The script in parts at sentence ends, each at least one sentence: the first up to FIRST_PART_WORDS
    words, then growing as PART_WORDS_BY_SEQ says, up to PART_WORDS."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", script.strip()) if s.strip()]
    parts: list[str] = []
    for sentence in sentences:
        limit = PART_WORDS_BY_SEQ[min(len(parts) - 1, len(PART_WORDS_BY_SEQ) - 1)] if parts else 0
        if parts and len(f"{parts[-1]} {sentence}".split()) <= limit:
            parts[-1] = f"{parts[-1]} {sentence}"
        else:
            parts.append(sentence)
    return parts


def audio_path(user_id: str, brief_id: str, seq: int, ext: str = AUDIO_EXT) -> str:
    """Where a part's file is kept: "<user id>/<brief id>/<seq>.<ext>", the shape brief_parts.audio_path must have."""
    return f"{user_id}/{brief_id}/{seq}.{ext}"


def trim_silence(wav: bytes, lead_ms: int = KEEP_LEAD_MS, tail_ms: int = KEEP_TAIL_MS) -> bytes:
    """A 16-bit mono WAV with the silence at its ends cut down to lead_ms and tail_ms. Anything else is
    returned as it is."""
    with wave.open(io.BytesIO(wav), "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            return wav
        rate, frames = w.getframerate(), w.readframes(w.getnframes())
    samples = array("h", frames[: len(frames) // 2 * 2])
    if sys.byteorder == "big":
        samples.byteswap()  # WAV samples are little-endian
    count = len(samples)
    first = next((i for i in range(count) if abs(samples[i]) >= SILENCE), None)
    if first is None:
        return wav
    last = next(i for i in range(count - 1, -1, -1) if abs(samples[i]) >= SILENCE)
    start = max(0, first - rate * lead_ms // 1000)
    end = min(count, last + 1 + rate * tail_ms // 1000)
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames[2 * start:2 * end])
    return out.getvalue()


def wav_seconds(wav: bytes) -> int:
    with wave.open(io.BytesIO(wav), "rb") as w:
        return round(w.getnframes() / float(w.getframerate() or 1))


def sections(threads: list[dict[str, Any]], now: datetime) -> dict[str, list[dict[str, Any]]]:
    """Conversations sorted as the Summary page sorts them, each in the first section it fits."""
    rank = {"urgent": 0, "important": 1, "normal": 2, "low": 3}

    def age_h(t: dict[str, Any]) -> float:
        at = datetime.fromisoformat(str(t["last_message_at"]).replace("Z", "+00:00"))
        return (now - at).total_seconds() / 3600

    # A conversation you answered last waits on them, whatever priority and category triage gave it.
    open_ = [t for t in threads if t.get("status") == "inbox" and not t.get("junk") and not t.get("last_from_me")]
    reply = [t for t in open_ if t.get("needs_reply") and age_h(t) <= REPLY_DAYS * 24]
    taken = {t["id"] for t in reply}
    priority = [
        t for t in open_
        if t["id"] not in taken and t.get("priority") in ("urgent", "important")
        and t.get("category") not in ("newsletter", "notification") and age_h(t) <= PRIORITY_DAYS * 24
    ]
    taken |= {t["id"] for t in priority}
    updates = [
        t for t in open_
        if t["id"] not in taken and t.get("category") in ("fyi", "work") and (t.get("summary") or "").strip() and age_h(t) <= UPDATE_HOURS
    ]
    pressing = lambda t: (rank.get(t.get("priority") or "normal", 2), -datetime.fromisoformat(str(t["last_message_at"]).replace("Z", "+00:00")).timestamp())
    return {"reply": sorted(reply, key=pressing), "priority": sorted(priority, key=pressing), "updates": updates}


def _when(at: Any) -> datetime:
    return datetime.fromisoformat(str(at).replace("Z", "+00:00"))


def task_day(t: dict[str, Any], zone: ZoneInfo) -> date:
    """The day a task is due: an all-day task's date as written (midnight UTC of it), a timed one's local day."""
    return date.fromisoformat(str(t["due_at"])[:10]) if t.get("due_all_day", True) else _when(t["due_at"]).astimezone(zone).date()


def task_sections(tasks: list[dict[str, Any]], today: date, zone: ZoneInfo) -> dict[str, list[dict[str, Any]]]:
    """Open tasks due today, in time order with all-day ones first, and open tasks due before today, the most
    recently due first. Completed tasks, tasks with no date and ones due later are left out."""
    open_ = [t for t in tasks if t.get("due_at") and t.get("status", "open") == "open"]
    due = [t for t in open_ if task_day(t, zone) == today]
    overdue = [t for t in open_ if task_day(t, zone) < today]
    return {
        "today": sorted(due, key=lambda t: (not t.get("due_all_day", True), _when(t["due_at"]))),
        "overdue": sorted(overdue, key=lambda t: _when(t["due_at"]), reverse=True),
    }


def build_prompt(
    name: str,
    today: date,
    zone: ZoneInfo,
    events: list[dict[str, Any]],
    parts: dict[str, list[dict[str, Any]]],
    now: datetime,
    tasks: dict[str, list[dict[str, Any]]] | None = None,
) -> str:
    """Everything the script may say. Conversations carry who, which channel, how long ago and the summary.
    Tasks carry their title and when they were due."""

    def when(e: dict[str, Any]) -> str:
        if e.get("all_day"):
            return "all day"
        start = datetime.fromisoformat(str(e["starts_at"]).replace("Z", "+00:00")).astimezone(zone)
        end = datetime.fromisoformat(str(e["ends_at"]).replace("Z", "+00:00")).astimezone(zone) if e.get("ends_at") else None
        return f"{start:%H:%M}" + (f" to {end:%H:%M}" if end and end != start else "")

    def ago(t: dict[str, Any]) -> str:
        hours = (now - datetime.fromisoformat(str(t["last_message_at"]).replace("Z", "+00:00"))).total_seconds() / 3600
        return f"{round(hours)} hours ago" if hours < 36 else f"{round(hours / 24)} days ago"

    def line(t: dict[str, Any]) -> str:
        return f"- {t['_who']} ({'WhatsApp' if t.get('channel') == 'whatsapp' else 'email'}, {ago(t)}): {(t.get('summary') or '').strip()[:300]}"

    lines = [
        f"Their first name: {name.split()[0] if name.strip() else 'not known'}",
        f"Today: {today:%A %d %B %Y}",
        f"Time now: {now.astimezone(zone):%H:%M}",
        "",
        "Calendar today:",
    ]
    lines += [f"- {when(e)}: {(e.get('title') or 'No title').strip()[:200]}" + (f", at {e['location'].strip()[:200]}" if (e.get("location") or "").strip() else "") for e in events] or ["(nothing)"]

    def task_line(t: dict[str, Any], overdue: bool) -> str:
        title = (t.get("title") or "").strip()[:200]
        if overdue:
            days = (today - task_day(t, zone)).days
            return f"- {title} (due {'yesterday' if days == 1 else str(days) + ' days ago'})"
        at = "all day" if t.get("due_all_day", True) else f"{_when(t['due_at']).astimezone(zone):%H:%M}"
        return f"- {at}: {title}"

    for key, heading in (("overdue", "Overdue tasks"), ("today", "Tasks due today")):
        # A task without a title has nothing the script could say about it.
        listed = [t for t in (tasks or {}).get(key, []) if (t.get("title") or "").strip()]
        counted = f" ({len(listed)} in all)" if len(listed) > MAX_TASKS else ""
        lines += ["", f"{heading}{counted}:"] + ([task_line(t, key == "overdue") for t in listed[:MAX_TASKS]] or ["(none)"])
    for key, title in (("reply", "Waiting on their reply"), ("priority", "Urgent or important"), ("updates", "Updates from the last day")):
        # Without a summary there is nothing the script could say about it.
        said = [t for t in parts[key] if (t.get("summary") or "").strip()]
        lines += ["", f"{title}:"] + ([line(t) for t in said[:MAX_ITEMS]] or ["(none)"])
    return "\n".join(lines)


class Brief:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, tts_model: str, voice: str, vault: Vault | None = None):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.tts_model = tts_model
        self.voice = voice
        self.vault = vault or Vault(db)
        self._pruned: date | None = None
        self._profiles: tuple[float, list[dict[str, Any]]] | None = None
        self._made: set[tuple[str, str]] = set()  # (user, day) briefs known to exist, so they are not asked about again

    def run_once(self) -> int:
        """Speaks written briefs people want to hear, writes and speaks asked-for briefs, then writes (without
        speech) the day's brief for anyone now past their briefing time."""
        now = datetime.now(timezone.utc)
        self._sweep(now)
        done = 0
        for row in self.db.select("briefs", {"select": "id,user_id", "status": "eq.speak_pending", "order": "updated_at", "limit": "5"}):
            if self._claim(row["id"], "speak_pending"):
                done += self._speak_written(row["id"], row["user_id"])
        for row in self.db.select("briefs", {"select": "id,user_id,for_date", "status": "eq.pending", "order": "created_at", "limit": "5"}):
            if self._claim(row["id"], "pending"):
                done += self._write(row["id"], row["user_id"], date.fromisoformat(row["for_date"]), now)
        # Who is due is worked out here from profiles read every PROFILES_TTL_S, not selected on each look.
        due = {p["user_id"]: d for p in self._profile_rows() if (d := due_today(now, zone_of(p.get("timezone")), p.get("briefing_time")))}
        due = {u: d for u, d in due.items() if (u, d.isoformat()) not in self._made}
        if due:
            have = self.db.select("briefs", {"select": "user_id,for_date", "user_id": in_list(sorted(due)), "for_date": f"gte.{min(due.values())}"})
            made = {(h["user_id"], h["for_date"]) for h in have}
            self._made |= made
            for user_id, day in due.items():
                if (user_id, day.isoformat()) in made:
                    continue
                self._made.add((user_id, day.isoformat()))
                rows = self.db.insert_new("briefs", {"user_id": user_id, "for_date": day.isoformat(), "status": "working"}, "user_id,for_date")
                if rows:
                    done += self._write(rows[0]["id"], user_id, day, now, speak=False)
        return done

    def _profile_rows(self) -> list[dict[str, Any]]:
        now = time.monotonic()
        if self._profiles is None or now - self._profiles[0] > PROFILES_TTL_S:
            self._profiles = (now, self.db.select("profiles", {"select": "user_id,timezone,briefing_time"}))
            if len(self._made) > 5000:  # only today's and yesterday's matter
                self._made.clear()
        return self._profiles[1]

    def _claim(self, brief_id: str, status: str) -> bool:
        """Takes a brief that is waiting (status 'pending' to write, 'speak_pending' to speak), so it is
        done once even if two workers look."""
        return bool(self.db.update("briefs", {"id": f"eq.{brief_id}", "status": f"eq.{status}"}, {"status": "working", "updated_at": _iso(datetime.now(timezone.utc))}))

    def _sweep(self, now: datetime) -> None:
        self.db.update(
            "briefs",
            {"status": "in.(working,speaking)", "updated_at": f"lt.{_iso(now - STALE_AFTER)}"},
            {"status": "failed", "error": "timed_out", "updated_at": _iso(now)},
            minimal=True,
        )
        # Nobody took a request to speak: the brief is still there to be spoken, so ask again.
        self.db.update(
            "briefs",
            {"status": "eq.speak_pending", "updated_at": f"lt.{_iso(now - STALE_AFTER)}"},
            {"status": "written", "updated_at": _iso(now)},
            minimal=True,
        )
        if self._pruned != now.date():
            self._pruned = now.date()
            self._prune((now - timedelta(days=KEEP_DAYS)).date())

    def _prune(self, before: date) -> None:
        """Deletes briefs for days before `before`, their audio files first: a row is deleted only once its
        files are gone, so a failure leaves it to be tried again tomorrow."""
        while True:
            old = self.db.select("briefs", {"select": "id,user_id", "for_date": f"lt.{before.isoformat()}", "order": "for_date", "limit": str(PRUNE_BATCH)})
            gone: list[str] = []
            for b in old:
                try:
                    self._remove_audio(b["id"], b["user_id"])
                    gone.append(b["id"])
                except Exception as err:
                    log.warn("brief audio not removed", user=b["user_id"], code=getattr(err, "status", None) or type(err).__name__)
            if gone:
                self.db.delete("briefs", {"id": in_list(gone)})
            if len(old) < PRUNE_BATCH or len(gone) < len(old):
                return

    def _remove_audio(self, brief_id: str, user_id: str) -> None:
        """Deletes every audio file of a brief, found by listing its folder so files without a row go too."""
        folder = f"{user_id}/{brief_id}"
        names = self.db.list_files(AUDIO_BUCKET, folder)
        self.db.remove_files(AUDIO_BUCKET, [f"{folder}/{n}" for n in names])

    def _write(self, brief_id: str, user_id: str, day: date, now: datetime, speak: bool = True) -> int:
        """Writes the script, and speaks it too unless speak is False: then the brief is 'written' and is
        spoken when the app asks (_speak_written)."""
        try:
            profile = self.db.first("profiles", {"select": "display_name,timezone,brief_voice", "user_id": f"eq.{user_id}"}) or {}
            voice = self._voice(profile)
            zone = zone_of(profile.get("timezone"))
            start = datetime.combine(day, dtime(0, 0), zone).astimezone(timezone.utc)
            end = start + timedelta(days=1)
            events = [
                e for e in self.db.select(
                    "calendar_events",
                    {
                        "select": "title,starts_at,ends_at,all_day,location",
                        "user_id": f"eq.{user_id}",
                        "starts_at": f"lt.{_iso(end)}",
                        "or": f"(starts_at.gte.{_iso(start)},ends_at.gt.{_iso(start)})",
                        "order": "starts_at",
                        "limit": "50",
                    },
                )
            ]
            for e in events:  # sealed or plain; never logged
                e["title"] = self.vault.open(user_id, EVENT_TITLE, e.get("title"))
                e["location"] = self.vault.open(user_id, EVENT_LOCATION, e.get("location"))
            threads = self.db.select(
                "threads",
                {
                    "select": "id,channel,is_group,group_name,summary,priority,category,needs_reply,last_from_me,status,junk,last_message_at,"
                    "thread_participants(contacts(display_name))",
                    "user_id": f"eq.{user_id}",
                    "status": "eq.inbox",
                    "junk": "eq.false",
                    "last_message_at": f"gte.{_iso(now - timedelta(days=REPLY_DAYS))}",
                    "order": "last_message_at.desc",
                    "limit": "300",
                },
            )
            # Open tasks due by the end of the day, overdue ones included; the newest due first, so a long
            # backlog leaves out the oldest. The title is opened, nothing else.
            tasks = self.db.select(
                "tasks",
                {
                    "select": "title,due_at,due_all_day,status",
                    "user_id": f"eq.{user_id}",
                    "status": "eq.open",
                    "due_at": f"lt.{_iso(end)}",
                    "order": "due_at.desc",
                    "limit": "50",
                },
            )
            for task in tasks:
                task["title"] = self.vault.open(user_id, TASK_TITLE, task.get("title"))
            for t in threads:
                t["summary"] = self.vault.open(user_id, SUMMARY, t.get("summary"))
                names = [self.vault.open(user_id, NAME, (p.get("contacts") or {}).get("display_name")) for p in t.get("thread_participants") or []]
                t["_who"] = (t.get("group_name") if t.get("is_group") else None) or next((n for n in names if n), None) or "Someone"
            prompt = build_prompt(profile.get("display_name") or "", day, zone, events, sections(threads, now), now, task_sections(tasks, day, zone))
            usage = UsageContext(user_id, "brief")
            script = str(self.gemini.json(self.model, SYSTEM, prompt, SCHEMA, usage, temperature=0.4, max_output=SCRIPT_MAX_OUTPUT).get("script") or "").strip()
            if not script:
                raise GeminiError(None, "empty script")
            parts = split_parts(script)
            if not speak:
                self.db.update(
                    "briefs",
                    {"id": f"eq.{brief_id}"},
                    {"status": "written", "script": self.vault.seal(user_id, BRIEF, script), "parts": None, "voice": None, "seconds": None, "error": None, "updated_at": _iso(datetime.now(timezone.utc))},
                    minimal=True,
                )
                log.info("brief written", user=user_id, events=len(events), tasks=len(tasks), threads=len(threads), parts=len(parts), spoken=False)
                return 1
            seconds = self._speak(brief_id, user_id, script, parts, voice, usage)
            self.db.update(
                "briefs",
                {"id": f"eq.{brief_id}"},
                {"status": "ready", "seconds": seconds, "error": None, "updated_at": _iso(datetime.now(timezone.utc))},
                minimal=True,
            )
            log.info("brief written", user=user_id, events=len(events), tasks=len(tasks), threads=len(threads), parts=len(parts), seconds=seconds)
            return 1
        except Exception as err:
            reason = getattr(err, "status", None) or type(err).__name__
            log.warn("brief failed", user=user_id, code=reason)
            self.db.update("briefs", {"id": f"eq.{brief_id}"}, {"status": "failed", "error": "write_failed", "updated_at": _iso(datetime.now(timezone.utc))}, minimal=True)
            return 0

    def _voice(self, profile: dict[str, Any]) -> str:
        return profile.get("brief_voice") if profile.get("brief_voice") in VOICES else self.voice

    def _speak_written(self, brief_id: str, user_id: str) -> int:
        """Speaks a brief that was written without speech, in the voice chosen now, then marks it ready."""
        try:
            stored = self.db.first("briefs", {"select": "script", "id": f"eq.{brief_id}"}) or {}
            script = self.vault.open(user_id, BRIEF, stored.get("script")) or ""
            parts = split_parts(script)
            if not parts:
                raise GeminiError(None, "no script to speak")
            profile = self.db.first("profiles", {"select": "brief_voice", "user_id": f"eq.{user_id}"}) or {}
            voice = self._voice(profile)
            seconds = self._speak(brief_id, user_id, script, parts, voice, UsageContext(user_id, "brief"))
            self.db.update("briefs", {"id": f"eq.{brief_id}"}, {"status": "ready", "seconds": seconds, "error": None, "updated_at": _iso(datetime.now(timezone.utc))}, minimal=True)
            log.info("brief spoken", user=user_id, parts=len(parts), seconds=seconds)
            return 1
        except Exception as err:
            log.warn("brief speech failed", user=user_id, code=getattr(err, "status", None) or type(err).__name__)
            self.db.update("briefs", {"id": f"eq.{brief_id}"}, {"status": "failed", "error": "speak_failed", "updated_at": _iso(datetime.now(timezone.utc))}, minimal=True)
            return 0


    def _speak(self, brief_id: str, user_id: str, script: str, parts: list[str], voice: str, usage: UsageContext) -> int:
        """Speaks the parts and stores each as it is ready: the first on its own, then the brief turns
        'speaking' so the app can start, and the rest at once. Returns the total length in seconds."""
        # A brief written again replaces its parts, files included.
        self._remove_audio(brief_id, user_id)
        self.db.delete("brief_parts", {"brief_id": f"eq.{brief_id}"})

        def speak(seq: int) -> int:
            wav = trim_silence(self.gemini.speak(self.tts_model, f"{READ_AS}\n\n{parts[seq]}", voice, usage))
            length = wav_seconds(wav)
            path = audio_path(user_id, brief_id, seq)
            sealed = self.vault.seal(user_id, BRIEF, base64.b64encode(wav).decode()) or ""
            self.db.upload(AUDIO_BUCKET, path, sealed.encode(), "text/plain")
            try:
                self.db.insert("brief_parts", {"brief_id": brief_id, "user_id": user_id, "seq": seq, "audio_path": path, "seconds": length})
            except Exception:
                try:
                    self.db.remove_files(AUDIO_BUCKET, [path])  # no row names the file, so nothing else would remove it
                except Exception:
                    pass
                raise
            return length

        first = speak(0)
        self.db.update(
            "briefs",
            {"id": f"eq.{brief_id}"},
            {"status": "speaking", "script": self.vault.seal(user_id, BRIEF, script), "parts": len(parts), "voice": voice, "updated_at": _iso(datetime.now(timezone.utc))},
            minimal=True,
        )
        with ThreadPoolExecutor(max_workers=SPEAKERS, thread_name_prefix="speak") as pool:
            return first + sum(pool.map(speak, range(1, len(parts))))


def _iso(at: datetime) -> str:
    return at.astimezone(timezone.utc).isoformat()
