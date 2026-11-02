"""Previews: "In the last 30 days this would have made N leads", shown before an automation is turned on. The app inserts a row in
automation_previews with the setup (sealed); this reads the last 30 days of the user's email, runs the same When and the same fixed
parser a live run would, and writes the sealed answer. Nothing is made, no model is called, nothing is sent.

A template is previewed by its parser, so the list is exact. A custom automation reads with Gemini, which a preview does not spend,
so it reports only how many emails match and which. Leads are people (one email address or number is one lead however many times
they wrote), newest enquiry first."""

from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from .. import log
from ..fields import ADDRESS, AUTOMATION, AUTOMATION_RUN, SUBJECT
from ..poll import Backoff
from ..supabase import missing_relation
from .match import matches, pre_matches
from .messages import bodies, own_addresses
from .read import parse_fixed
from .spec import Spec, load_spec
from .templates import parser_for

DAYS = 30
PAGE = 300  # message rows read at a time
MAX_SCAN = 3000  # rows looked at in all, newest first; a very busy inbox is cut here and the answer says so
MAX_READ = 300  # emails whose body is read: the ones the sender and subject already allow
MAX_LEADS = 50  # leads listed; the count is of all of them
EVERY_S = 3
IDLE_S = 30
STALE = timedelta(minutes=10)  # a preview claimed and never finished (the worker stopped) is taken again after this


def summarise(spec: Spec, template_key: str | None, items: list[dict[str, Any]], own: set[str], scanned: int) -> dict[str, Any]:
    """The answer for these emails (each {account_id, sender, subject, sent_at, text, links}): matches counted, and for a template
    the leads read from them. Pure."""
    matched = [i for i in items if matches(spec.when, account_id=i["account_id"], sender=i["sender"], subject=i["subject"], body=i["text"])]
    people: dict[str, dict[str, Any]] = {}
    unreadable = 0
    if parser_for(template_key) is not None:
        for i in sorted(matched, key=lambda x: x["sent_at"], reverse=True):  # newest first, so each person keeps their latest enquiry
            fields = parse_fixed(template_key, i["text"], i["links"], own)
            if not fields:
                unreadable += 1
                continue
            key = fields.get("email") or fields.get("phone") or fields["name"]
            person = people.setdefault(key, {"name": fields["name"], "listing": fields.get("listing") or fields.get("listing_ref") or "", "at": i["sent_at"], "enquiries": 0})
            person["enquiries"] += 1
        return {"mode": "parsed", "matched": len(matched), "unreadable": unreadable, "count": len(people), "leads": list(people.values())[:MAX_LEADS], "cut": scanned >= MAX_SCAN}
    emails = [{"name": i["sender"] or "", "listing": i["subject"] or "", "at": i["sent_at"], "enquiries": 1} for i in matched]
    return {"mode": "matched", "matched": len(matched), "unreadable": 0, "count": len(matched), "leads": emails[:MAX_LEADS], "cut": scanned >= MAX_SCAN}


class Previews:
    def __init__(self, db: Any, vault: Any):
        self.db = db
        self.vault = vault

    def loop(self, stop: threading.Event) -> None:
        """Answers queued previews, quick while there are some and backing off when there are none. A missing table waits ten minutes."""
        wait = Backoff(EVERY_S, IDLE_S)
        while not stop.is_set():
            found = True
            try:
                found = self.run_once() > 0
            except Exception as err:
                if missing_relation(err):
                    stop.wait(600)
                    continue
                log.error("automation previews failed", code=log.code_of(err))
            stop.wait(wait.next(found))

    def run_once(self) -> int:
        """Takes one queued preview, answers it, and returns how many it answered (0 or 1)."""
        stale = (datetime.now(timezone.utc) - STALE).isoformat()
        rows = self.db.select(
            "automation_previews",
            {"select": "id,user_id,template_key,spec", "or": f"(status.eq.queued,and(status.eq.running,claimed_at.lt.{stale}))", "order": "created_at.asc", "limit": "1"},
        )
        for r in rows:
            claimed = self.db.update(
                "automation_previews", {"id": f"eq.{r['id']}", "or": f"(status.eq.queued,and(status.eq.running,claimed_at.lt.{stale}))"},
                {"status": "running", "claimed_at": datetime.now(timezone.utc).isoformat()},
            )
            if not claimed:
                continue
            try:
                spec = load_spec(self.vault.open(r["user_id"], AUTOMATION, r["spec"]))
                if spec is None:
                    raise ValueError("bad_spec")
                items, scanned = self._items(r["user_id"], spec)
                answer = summarise(spec, r.get("template_key"), items, own_addresses(self.db, self.vault, r["user_id"]), scanned)
                self.db.update(
                    "automation_previews", {"id": f"eq.{r['id']}"},
                    {"status": "done", "result": self.vault.seal(r["user_id"], AUTOMATION_RUN, json.dumps(answer, ensure_ascii=False))}, minimal=True,
                )
                log.info("automation preview", preview=r["id"], matched=answer["matched"], leads=answer["count"])
            except Exception as err:
                log.warn("automation preview failed", preview=r["id"], code=log.code_of(err))
                self.db.update("automation_previews", {"id": f"eq.{r['id']}"}, {"status": "failed", "error": "preview_failed"}, minimal=True)
            return 1
        return 0

    def _items(self, user: str, spec: Spec) -> tuple[list[dict[str, Any]], int]:
        """The last 30 days of inbound email the sender and subject allow, with their bodies, and how many rows were looked at. Reads only."""
        since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).isoformat()
        kept: list[dict[str, Any]] = []
        scanned = 0
        while scanned < MAX_SCAN and len(kept) < MAX_READ:
            rows = self.db.select(
                "messages",
                {
                    "select": "id,account_id,subject,sender_address,sent_at,threads!inner(channel)", "user_id": f"eq.{user}", "direction": "eq.inbound",
                    "threads.channel": "eq.email", "sent_at": f"gte.{since}", "order": "sent_at.desc", "limit": str(PAGE), "offset": str(scanned),
                },
            )
            if not rows:
                break
            scanned += len(rows)
            for r in rows:
                sender, subject = (self.vault.open(user, ADDRESS, r.get("sender_address")) or ""), (self.vault.open(user, SUBJECT, r.get("subject")) or "")
                if pre_matches(spec.when, account_id=r["account_id"], sender=sender, subject=subject) and len(kept) < MAX_READ:
                    kept.append({"id": r["id"], "account_id": r["account_id"], "sender": sender, "subject": subject, "sent_at": r["sent_at"]})
            if len(rows) < PAGE:
                break
        texts = bodies(self.db, self.vault, user, [k["id"] for k in kept])
        return [{**k, "text": texts[k["id"]][0], "links": texts[k["id"]][1]} for k in kept if k["id"] in texts], scanned
