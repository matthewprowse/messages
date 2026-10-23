"""The spoken daily brief: today's calendar and the conversations waiting on you, as a short script read
aloud by Gemini, for listening on the move.

One brief per user per local day (public.briefs). It is written at profiles.briefing_time in their time
zone, or straight away when the app asks for one (a 'pending' row, also how Refresh works). The script
comes from the same labels the Summary page uses: needs a reply, urgent or important, and FYI or work
updates from the last day, with each conversation's one-line summary. Nothing is read from message
bodies. The script and the audio are encrypted (field "brief"); briefs older than KEEP_DAYS are deleted,
as the audio is large.

Runs in its own thread, as writing and speaking a brief takes up to a minute and triage should not wait
on it."""

from __future__ import annotations

import base64
import io
import wave
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import log
from .fields import BRIEF, NAME, SUMMARY
from .gemini import Gemini, GeminiError, UsageContext
from .supabase import Supabase, in_list
from .vault import Vault

POLL_S = 10
KEEP_DAYS = 7
STALE_AFTER = timedelta(minutes=10)  # a brief still 'working' this long was cut off (a restart) and is failed
REPLY_DAYS = 14  # the same windows as the Summary page (apps/web/lib/summary.ts)
PRIORITY_DAYS = 7
UPDATE_HOURS = 24
MAX_ITEMS = 8  # conversations per section in the prompt
DEFAULT_ZONE = "Africa/Johannesburg"

SCHEMA = {
    "type": "object",
    "properties": {"script": {"type": "string", "description": "The brief, ready to be read aloud."}},
    "required": ["script"],
}

SYSTEM = """You write a short spoken morning brief for one busy professional. A voice reads it aloud, often
while they drive, so it must sound natural when heard, not read.

- 120 to 220 words. Plain sentences only: no lists, headings, bullet points, emojis, links, email
  addresses or phone numbers. Never use em dashes.
- Open with a greeting that suits the time given (good morning, good afternoon or good evening), by
  first name when given, and the day, then their calendar in time order, then
  who is waiting on a reply (most important first: who, and in a few words what they want), then
  anything else urgent or important, then a one-line close. Mention updates only if there is room.
- Say times the way people speak them ("half past nine", "three in the afternoon"), never "15:00".
- Use only the facts given. Do not invent people, times, places or requests. Leave out anything you
  cannot say clearly.
- When there is nothing on, say so in a sentence or two and keep it short."""

VOICE_STYLE = "Read this morning brief in a warm, calm and clear voice, at an easy pace:\n\n"


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


def wav_seconds(wav: bytes) -> int:
    with wave.open(io.BytesIO(wav), "rb") as w:
        return round(w.getnframes() / float(w.getframerate() or 1))


def sections(threads: list[dict[str, Any]], now: datetime) -> dict[str, list[dict[str, Any]]]:
    """Conversations sorted as the Summary page sorts them, each in the first section it fits."""
    rank = {"urgent": 0, "important": 1, "normal": 2, "low": 3}

    def age_h(t: dict[str, Any]) -> float:
        at = datetime.fromisoformat(str(t["last_message_at"]).replace("Z", "+00:00"))
        return (now - at).total_seconds() / 3600

    open_ = [t for t in threads if t.get("status") == "inbox" and not t.get("junk")]
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


def build_prompt(name: str, today: date, zone: ZoneInfo, events: list[dict[str, Any]], parts: dict[str, list[dict[str, Any]]], now: datetime) -> str:
    """Everything the script may say. Conversations carry who, which channel, how long ago and the summary."""

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
        return f"- {t['_who']} ({'WhatsApp' if t.get('channel') == 'whatsapp' else 'email'}, {ago(t)}, {t.get('priority') or 'normal'}): {(t.get('summary') or '').strip() or 'no summary'}"

    lines = [
        f"Their first name: {name.split()[0] if name.strip() else 'not known'}",
        f"Today: {today:%A %d %B %Y}",
        f"Time now: {now.astimezone(zone):%H:%M}",
        "",
        "Calendar today:",
    ]
    lines += [f"- {when(e)}: {(e.get('title') or 'No title').strip()}" + (f", at {e['location'].strip()}" if (e.get("location") or "").strip() else "") for e in events] or ["(nothing)"]
    for key, title in (("reply", "Waiting on their reply"), ("priority", "Urgent or important"), ("updates", "Updates from the last day")):
        lines += ["", f"{title}:"] + ([line(t) for t in parts[key][:MAX_ITEMS]] or ["(none)"])
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

    def run_once(self) -> int:
        """Writes asked-for briefs, then the day's brief for anyone now past their briefing time."""
        now = datetime.now(timezone.utc)
        self._sweep(now)
        done = 0
        for row in self.db.select("briefs", {"select": "id,user_id,for_date", "status": "eq.pending", "order": "created_at", "limit": "5"}):
            if self._claim(row["id"]):
                done += self._write(row["id"], row["user_id"], date.fromisoformat(row["for_date"]), now)
        profiles = self.db.select("profiles", {"select": "user_id,timezone,briefing_time"})
        due = {p["user_id"]: d for p in profiles if (d := due_today(now, zone_of(p.get("timezone")), p.get("briefing_time")))}
        if due:
            have = self.db.select("briefs", {"select": "user_id,for_date", "user_id": in_list(sorted(due)), "for_date": f"gte.{min(due.values())}"})
            made = {(h["user_id"], h["for_date"]) for h in have}
            for user_id, day in due.items():
                if (user_id, day.isoformat()) in made:
                    continue
                rows = self.db.insert_new("briefs", {"user_id": user_id, "for_date": day.isoformat(), "status": "working"}, "user_id,for_date")
                if rows:
                    done += self._write(rows[0]["id"], user_id, day, now)
        return done

    def _claim(self, brief_id: str) -> bool:
        """Takes a pending brief, so it is written once even if two workers look."""
        return bool(self.db.update("briefs", {"id": f"eq.{brief_id}", "status": "eq.pending"}, {"status": "working", "updated_at": _iso(datetime.now(timezone.utc))}))

    def _sweep(self, now: datetime) -> None:
        self.db.update(
            "briefs",
            {"status": "eq.working", "updated_at": f"lt.{_iso(now - STALE_AFTER)}"},
            {"status": "failed", "error": "Took too long", "updated_at": _iso(now)},
            minimal=True,
        )
        if self._pruned != now.date():
            self._pruned = now.date()
            self.db.delete("briefs", {"for_date": f"lt.{(now - timedelta(days=KEEP_DAYS)).date().isoformat()}"})

    def _write(self, brief_id: str, user_id: str, day: date, now: datetime) -> int:
        try:
            profile = self.db.first("profiles", {"select": "display_name,timezone", "user_id": f"eq.{user_id}"}) or {}
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
            threads = self.db.select(
                "threads",
                {
                    "select": "id,channel,is_group,group_name,summary,priority,category,needs_reply,status,junk,last_message_at,"
                    "thread_participants(contacts(display_name))",
                    "user_id": f"eq.{user_id}",
                    "status": "eq.inbox",
                    "junk": "eq.false",
                    "last_message_at": f"gte.{_iso(now - timedelta(days=REPLY_DAYS))}",
                    "order": "last_message_at.desc",
                    "limit": "300",
                },
            )
            for t in threads:
                t["summary"] = self.vault.open(user_id, SUMMARY, t.get("summary"))
                names = [self.vault.open(user_id, NAME, (p.get("contacts") or {}).get("display_name")) for p in t.get("thread_participants") or []]
                t["_who"] = (t.get("group_name") if t.get("is_group") else None) or next((n for n in names if n), None) or "Someone"
            prompt = build_prompt(profile.get("display_name") or "", day, zone, events, sections(threads, now), now)
            usage = UsageContext(user_id, "brief")
            script = str(self.gemini.json(self.model, SYSTEM, prompt, SCHEMA, usage, temperature=0.4).get("script") or "").strip()
            if not script:
                raise GeminiError(None, "empty script")
            wav = self.gemini.speak(self.tts_model, VOICE_STYLE + script, self.voice, usage)
            self.db.update(
                "briefs",
                {"id": f"eq.{brief_id}"},
                {
                    "status": "ready",
                    "script": self.vault.seal(user_id, BRIEF, script),
                    "audio": self.vault.seal(user_id, BRIEF, base64.b64encode(wav).decode()),
                    "seconds": wav_seconds(wav),
                    "error": None,
                    "updated_at": _iso(datetime.now(timezone.utc)),
                },
                minimal=True,
            )
            log.info("brief written", user=user_id, events=len(events), threads=len(threads), seconds=wav_seconds(wav))
            return 1
        except Exception as err:
            reason = getattr(err, "status", None) or type(err).__name__
            log.warn("brief failed", user=user_id, code=reason)
            self.db.update("briefs", {"id": f"eq.{brief_id}"}, {"status": "failed", "error": "Could not write the brief", "updated_at": _iso(datetime.now(timezone.utc))}, minimal=True)
            return 0


def _iso(at: datetime) -> str:
    return at.astimezone(timezone.utc).isoformat()
