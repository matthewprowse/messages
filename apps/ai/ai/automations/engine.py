"""The automations engine. Triage calls after_triage() with the messages it has just sorted; for each new inbound email it runs the
user's enabled automations: match When, Read with the fixed parser (Gemini only when there is none or it failed), Do, and record the
run. One run per automation and message (the claim row is unique), so a message is never run twice, however often triage sees it.

Only recent mail is considered (a connected inbox's backlog must not make leads), and only mail that arrived after the automation
was turned on. A failure here never reaches triage: it is logged as a count and an error code, never as content."""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from .. import log
from ..fields import AUTOMATION, AUTOMATION_RUN
from ..gemini import Gemini, GeminiError
from ..gemini_types import UsageContext
from ..retry import billing_paused
from ..supabase import Supabase, in_list, missing_relation
from ..vault import Vault
from .do import Doer
from .extract import extract
from .match import matches, pre_matches
from .messages import bodies, own_addresses
from .previews import Previews
from .read import fields_to_ask, parse_fixed, reachable, with_name, worth_asking
from .spec import Spec, load_spec

RECENT = timedelta(days=3)  # older mail is a backlog, not a new enquiry
GEMINI_DAILY_CAP = 30  # Gemini reads for one person in a UTC day; a fixed parser has no cap


@dataclass
class Auto:
    id: str
    user_id: str
    template_key: str | None
    spec: Spec
    enabled_at: datetime | None


def _when(value: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


class Automations:
    def __init__(self, db: Supabase, gemini: Gemini, model: str, vault: Vault):
        self.db = db
        self.gemini = gemini
        self.model = model
        self.vault = vault
        self.doer = Doer(db, vault)
        self.previews = Previews(db, vault)

    def loop(self, stop: threading.Event) -> None:
        """The thread that answers preview requests (previews.py). Live runs are not here: triage calls after_triage."""
        self.previews.loop(stop)

    def after_triage(self, messages: list[dict[str, Any]]) -> int:
        """Runs the enabled automations of the people these messages belong to. Returns how many runs finished. Never raises."""
        try:
            return self._after(messages)
        except Exception as err:
            if not missing_relation(err):  # the migration is not applied yet: nothing to do, nothing to report
                log.warn("automations failed", code=log.code_of(err))
            return 0

    def _autos(self, users: list[str]) -> dict[str, list[Auto]]:
        out: dict[str, list[Auto]] = {}
        for r in self.db.select("automations", {"select": "id,user_id,template_key,spec,enabled_at", "user_id": in_list(users), "enabled": "eq.true"}):
            spec = load_spec(self.vault.open(r["user_id"], AUTOMATION, r["spec"]))
            if spec:
                out.setdefault(r["user_id"], []).append(Auto(r["id"], r["user_id"], r.get("template_key"), spec, _when(r.get("enabled_at"))))
            else:
                log.warn("automation spec unreadable", automation=r["id"])
        return out

    def _after(self, messages: list[dict[str, Any]]) -> int:
        now = datetime.now(timezone.utc)
        mail = [
            m for m in messages
            if (m.get("threads") or {}).get("channel") == "email" and (when := _when(m.get("sent_at"))) is not None and now - when < RECENT
        ]
        if not mail:
            return 0
        autos = self._autos(sorted({m["user_id"] for m in mail}))
        if not autos:
            return 0
        candidates: list[tuple[dict[str, Any], Auto]] = []
        for m in mail:
            sent = _when(m.get("sent_at"))
            for a in autos.get(m["user_id"], []):
                if a.enabled_at and sent and sent < a.enabled_at:
                    continue  # it arrived before the automation was turned on: the preview covered it, the run does not
                if pre_matches(a.spec.when, account_id=m.get("account_id"), sender=m.get("sender_address"), subject=m.get("subject")):
                    candidates.append((m, a))
        done = 0
        for user in sorted({m["user_id"] for m, _ in candidates}):
            mine = [(m, a) for m, a in candidates if m["user_id"] == user]
            texts = bodies(self.db, self.vault, user, sorted({m["id"] for m, _ in mine}))
            own = own_addresses(self.db, self.vault, user)
            for m, a in mine:
                if m["id"] in texts and matches(a.spec.when, account_id=m.get("account_id"), sender=m.get("sender_address"), subject=m.get("subject"), body=texts[m["id"]][0]):
                    done += self._run(a, m, texts[m["id"]], own)
        if done:
            log.info("automations ran", runs=done)
        return done

    def _gemini_left(self, user: str) -> bool:
        day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        used = self.db.count("automation_runs", {"user_id": f"eq.{user}", "read_by": "eq.gemini", "created_at": f"gte.{day}"})
        return used < GEMINI_DAILY_CAP

    def _run(self, a: Auto, m: dict[str, Any], body: tuple[str, list[str]], own: set[str]) -> int:
        """One automation on one email. Returns 1 when the run was recorded, 0 when another worker already had it."""
        user = m["user_id"]
        claimed = self.db.insert_new(
            "automation_runs", {"user_id": user, "automation_id": a.id, "message_id": m["id"], "thread_id": m.get("thread_id"), "status": "running"}, "automation_id,message_id"
        )
        if not claimed:
            return 0
        run = claimed[0]["id"]
        text, links = body
        fields = parse_fixed(a.template_key, text, links, own)
        read_by = "parser" if fields else None
        error: str | None = None
        if fields is None:
            asked = fields_to_ask(a.spec, a.template_key)
            if not asked:
                error = "no_fields"
            elif not worth_asking(text, own):
                error = "unreadable"
            elif not self._gemini_left(user):
                error = "ai_daily_limit"
            else:
                try:
                    fields = extract(self.gemini, self.model, UsageContext(user, "automations", m.get("account_id"), m.get("thread_id")), asked, m.get("sender_address"), m.get("subject"), text)
                    read_by = "gemini"
                except GeminiError as err:
                    error = "ai_paused" if billing_paused(err) else "ai_unavailable"
                    log.warn("automation read failed", run=run, code=log.code_of(err))
        if fields:
            fields = with_name(fields)
        if not fields or (a.spec.do.contact and not reachable(fields)):
            self.db.update("automation_runs", {"id": f"eq.{run}"}, {"status": "failed" if error and error.startswith("ai_") else "skipped", "read_by": read_by, "error": error or "unreadable"}, minimal=True)
            return 1
        outcome = self.doer.run(a.spec.do, user, m, fields)
        status = "failed" if a.spec.do.contact and outcome.contact_id is None else "done"
        self.db.update(
            "automation_runs", {"id": f"eq.{run}"},
            {
                "status": status, "read_by": read_by, "fields": self.vault.seal(user, AUTOMATION_RUN, json.dumps(fields, ensure_ascii=False)),
                "contact_id": outcome.contact_id, "effects": outcome.effects, "error": ",".join(outcome.failed) or None,
            },
            minimal=True,
        )
        return 1
