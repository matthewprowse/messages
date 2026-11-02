"""Triage's prompt and the reading of its answer: the JSON schema, the system instructions, the prompt built per
group of emails, the earlier-messages lines and the parsing of the model's results and choices. Pure: no network.
Split out of triage.py, which re-exports every name here."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .text import UNTRUSTED, fenced, new_fence
from .triage_signals import CATEGORIES, CONTEXT_MESSAGES, MAX_OPTIONS, NO_CHOICES, OPTION_KINDS, PRIORITIES, UserContext

SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "email": {"type": "integer", "description": "The number of the email this result is for."},
                    "priority": {"type": "string", "enum": PRIORITIES},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "junk": {"type": "boolean"},
                    "needs_reply": {"type": "boolean"},
                    "summary": {"type": "string", "description": "One plain sentence, at most 120 characters."},
                    "choices": {
                        "type": "array",
                        "description": "One-tap reply choices, or empty.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string", "description": "Button text, 1 to 4 words, Title Case."},
                                "decision": {"type": "string", "description": "What they decided, one short first-person sentence."},
                                "kind": {"type": "string", "enum": OPTION_KINDS},
                            },
                            "required": ["label", "decision", "kind"],
                        },
                    },
                    "asked_time": {"type": "string", "description": "YYYY-MM-DDTHH:MM, or empty."},
                    "asked_minutes": {"type": "integer", "description": "Length in minutes, or 0."},
                },
                "required": ["email", "priority", "category", "junk", "needs_reply", "summary", "choices", "asked_time", "asked_minutes"],
            },
        }
    },
    "required": ["results"],
}

SYSTEM = """You sort one person's incoming email. For each numbered email, decide:

priority
- urgent: needs them within hours (a deadline today, a real security or money problem, a person waiting on them now).
- important: a real person writing to them personally, work they are part of, appointments, bills and anything with consequences.
- normal: useful but not pressing.
- low: everything else.
Routine login codes, sign-in links, verification and welcome emails are normal, not urgent: they are only useful the moment they were asked for. A security alert about something they did not do is urgent.

category: personal, work, needs_reply (a person is asking them something), fyi, newsletter, notification (automated account or service messages).

junk: true for mail that is not written for them: marketing, promotions, sales, cold outreach, mass newsletters, generic automated alerts and digests, surveys, spam. False for anything personal, any reply in a conversation they took part in, receipts, bookings, security codes, bills and notices about accounts they hold. Bulk mail (it has an unsubscribe header) is junk unless it clearly matters to them personally.

needs_reply: true when a real person is waiting on them to say or do something: a question, a request, an invitation or a proposal to answer, plans being made that they have not settled, or a follow-up on something they have not answered. It is also true when the message is phrased as a statement but moves plans forward and a friend or colleague would expect a response (for example "turns out there are student tickets" after they agreed to go). Read the earlier messages of the conversation when they are shown: a question they already answered is not open, and a closing thanks or an acknowledgement ends it. When unsure about a person they know, lean towards true, since a missed message costs more than a false flag. False for automated senders, newsletters, receipts and notices, and for a message that only informs with nothing to respond to.

summary: one plain sentence saying what it is and what, if anything, they need to do. No greetings, no "This email". Write it to them: call them "you" and never use their own name, even when the email addresses them by name (write "Cindy wants to set up an interview with you", not "with Matthew Prowse"). Their name and own addresses are given; when no name is given, the name in an email's greeting or the name matching their address is theirs. An email from one of their own addresses is one they sent (a copy, or to themselves): summarise it as theirs, such as "Your application for the Business Analyst role, copied to your inbox."

choices: only when needs_reply is true and the answer needs a decision only they can make: whether they are free at a time, whether they will do or send something, a yes or no, which option, a price or an offer. Give 2 to 4 options they would realistically pick, each with:
- label: button text, 1 to 4 words in Title Case, such as "Yes, Available", "Not Available", "Sending Today", "Which Documents?".
- decision: what they decided, as one short first-person sentence the reply will say, such as "I am free on Thursday at 15:00 and will be there." Never add facts, prices or promises the option does not state.
- kind: accept (yes, agree, will do), decline (no, can't), other_time (offer a different time), answer (anything else, such as asking what they need).
When they are asked about a meeting, call or viewing time, include an other_time option labelled "Suggest Another Time". Otherwise, and whenever needs_reply is false, choices is empty.

asked_time: when the message asks whether they are free at a specific date and time, that time as YYYY-MM-DDTHH:MM, as written in the message (the sender's local time), working out the date from when it was sent. Otherwise empty. asked_minutes: how long it would take in minutes when stated or obvious, otherwise 0.

Use what you are told about them and their past corrections. Mail styled to look personal but sent to a list is still junk.

Judge each email on its own, though an email may show the earlier messages of its conversation (oldest first, "You" is them, "Them" is the other side): use those only as context. Return one result for every email, with its number.""" + UNTRUSTED


# Spelling and language for what is written about their mail. Never American by default: they write British.
LANGUAGE_NAMES = {"en-GB": "British English (colour, organise, cheque)", "en-US": "American English", "af": "Afrikaans"}

def triage_prompt(ctx: UserContext, emails: list[dict[str, Any]], fence: str | None = None) -> str:
    """What is known about them first (the same on every call of theirs), then the numbered emails.
    Each email has name, sender, relationship, known, bulk, subject and body. Each sits between lines carrying
    a random code (fence), so one email's text cannot pass for instructions or for another email."""
    fence = fence or new_fence()
    lines = [
        f"Their name: {ctx.name or 'not given'}",
        "Their own addresses: " + (", ".join(ctx.own_addresses) or "not given"),
        f"About them: {ctx.about or 'not given'}",
        f"People who matter to them: {ctx.important_people or 'not given'}",
        f"Write summaries in: {LANGUAGE_NAMES.get(ctx.language, 'the language and spelling they write in themselves (judge by their own sent emails and the email thread), British English when unclear')}",
    ]
    # Each correction names a conversation's subject, written by someone else, so the list sits between marked lines.
    if ctx.corrections:
        listed = "\n".join(ctx.corrections[:12])
        lines += ["Their recent corrections (subjects written by other people, between the marked lines):", fenced(listed, new_fence(listed))]
    else:
        lines.append("Their recent corrections: none")
    for i, e in enumerate(emails, 1):
        lines += [
            "",
            f"<<<{fence}",
            f"=== Email {i}",
            f"From: {e['name']} <{e['sender']}>",
            f"Relationship: {e['relationship'] or 'unknown'}",
            f"They have written to this sender before: {'yes' if e['known'] else 'no'}",
            f"Bulk mail with an unsubscribe header: {'yes' if e['bulk'] else 'no'}",
            f"Sent: {sent_label(e.get('sent'), ctx.timezone)}",
            f"Subject: {e['subject'] or '(none)'}",
            *earlier_lines(e.get("earlier") or []),
            "",
            e["body"],
            f"{fence}>>>",
        ]
    return "\n".join(lines)


def earlier_lines(earlier: list[dict[str, Any]]) -> list[str]:
    """The conversation so far as lines for the prompt, oldest first: "You" is the person whose mail it is."""
    if not earlier:
        return []
    return ["", "Earlier in this conversation, oldest first:"] + [f"{'You' if e['from_me'] else 'Them'}: {e['text']}" for e in earlier] + ["", "Newest message:"]


def earlier_messages(rows: list[dict[str, Any]], m: dict[str, Any], count: int = CONTEXT_MESSAGES) -> list[dict[str, Any]]:
    """The up to `count` messages of m's conversation sent before m, oldest first. rows are messages of
    several conversations, newest first, with thread_id, id, direction and sent_at."""
    try:
        before = datetime.fromisoformat(str(m["sent_at"]).replace("Z", "+00:00"))
        older = [r for r in rows if r["thread_id"] == m["thread_id"] and r["id"] != m["id"] and datetime.fromisoformat(str(r["sent_at"]).replace("Z", "+00:00")) < before]
    except (KeyError, ValueError, TypeError):
        return []
    return older[:count][::-1]


def sent_label(sent_at: str | None, tz: str = "") -> str:
    """"Thursday 29 October 2026, 15:05 SAST", in their time zone (UTC when it is not known or not valid), so
    the model can work out "tomorrow at 3"."""
    if not sent_at:
        return "unknown"
    try:
        at = datetime.fromisoformat(sent_at.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return "unknown"
    try:
        at = at.astimezone(ZoneInfo(tz)) if tz else at
    except (ZoneInfoNotFoundError, ValueError):
        pass
    return at.strftime("%A %d %B %Y, %H:%M %Z")


def read_choices(item: dict[str, Any]) -> str:
    """The choices from one model answer as JSON for message_ai.reply_choices: NO_CHOICES when there are
    none or they are unusable. Options need a label and a decision; a known kind; at most MAX_OPTIONS."""
    options = []
    for o in item.get("choices") if isinstance(item.get("choices"), list) else []:
        if not isinstance(o, dict):
            continue
        label = " ".join(str(o.get("label") or "").split())[:40]
        decision = " ".join(str(o.get("decision") or "").split())[:300]
        kind = o.get("kind") if o.get("kind") in OPTION_KINDS else "answer"
        if label and decision and label.lower() not in {x["label"].lower() for x in options}:
            options.append({"label": label, "decision": decision, "kind": kind})
    options = options[:MAX_OPTIONS]
    if len(options) < 2:
        return NO_CHOICES
    asked = str(item.get("asked_time") or "").strip()
    try:
        asked = datetime.strptime(asked[:16], "%Y-%m-%dT%H:%M").strftime("%Y-%m-%dT%H:%M") if asked else None
    except ValueError:
        asked = None
    minutes = item.get("asked_minutes")
    minutes = minutes if isinstance(minutes, int) and 5 <= minutes <= 24 * 60 else None
    return json.dumps({"asked": asked, "minutes": minutes, "options": options})


def read_results(result: Any, count: int) -> dict[int, dict[str, Any]]:
    """The model's answers by email number, 1 to count. A missing or malformed answer is left out."""
    out: dict[int, dict[str, Any]] = {}
    items = result.get("results") if isinstance(result, dict) else None
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            n = int(item.get("email"))
        except (TypeError, ValueError):
            continue
        if not 1 <= n <= count or n in out or not isinstance(item.get("junk"), bool):
            continue
        out[n] = {
            "priority": item.get("priority"),
            "category": item.get("category"),
            "junk": item["junk"],
            "needs_reply": item.get("needs_reply") is True,
            "summary": str(item.get("summary") or ""),
            "choices": read_choices(item),
        }
    return out
