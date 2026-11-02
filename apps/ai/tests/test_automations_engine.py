"""Tests for the automations engine (ai.automations.engine, do and previews) with a fake database and fake Gemini: a Property24
enquiry makes a contact marked a Lead with its source, a task, a pending draft addressed to the lead and an urgent thread; a repeat
enquirer joins their record; a message is never run twice; Gemini is asked only when the parser fails and the email can be acted on;
old, non-email and pre-enable mail is left alone; the 30 day preview counts people; nothing is ever sent."""

import json
import unittest
from datetime import datetime, timedelta, timezone

from ai.automations import engine as engine_module
from ai.automations.engine import Automations
from ai.automations.previews import Previews, summarise
from ai.automations.spec import parse_spec
from ai.gemini import GeminiError
from tests import automation_fixtures as fx

USER, ACCOUNT, THREAD, MESSAGE = "u1", "acc1", "t1", "m1"
NOW = datetime.now(timezone.utc)

P24_SPEC = {
    "name": "Property24 Enquiry",
    "when": {"senders": ["property24.com"], "anywhere": ["enquiry", "lead"]},
    "do": {"contact": True, "lead": True, "source": "Property24 Enquiry", "link": True, "task": {"title": "Call Back Within 5 Minutes", "minutes": 5}, "draft": True, "urgent": True},
}
CUSTOM_SPEC = {
    "name": "Website Form",
    "when": {"senders": ["forms.example.com"]},
    "read": {"fields": [{"key": "name", "description": "Their name"}, {"key": "email", "description": "Their email"}, {"key": "phone", "description": "Their number"}]},
    "do": {"contact": True, "lead": True, "source": "Website Form", "link": True},
}


class FakeVault:
    def seal(self, user, field, value):
        return None if value is None else f"s:{field}:{value}"

    def open(self, user, field, value):
        prefix = f"s:{field}:"
        return value[len(prefix):] if isinstance(value, str) and value.startswith(prefix) else value

    def keys_for(self, user):
        return None  # no keys: contacts are matched on the plain value


class FakeGemini:
    def __init__(self, answer=None, error=None):
        self.answer, self.error, self.calls = answer, error, []

    def json(self, model, system, prompt, schema, usage, **kw):
        self.calls.append((usage.feature, usage.user_id, prompt))
        if self.error:
            raise self.error
        return self.answer


class FakeDb:
    def __init__(self, autos, body, identities=None, accounts=None, contacts=None, drafts=None, existing_runs=()):
        self.autos, self.body, self.identities = autos, body, identities or {}
        self.accounts = accounts if accounts is not None else [{"id": "todo1", "address": None, "send_addresses": [], "provider": "google_tasks"}]
        self.contacts, self.drafts = contacts or {}, drafts or []
        self.inserts, self.updates, self.deletes, self.runs = [], [], [], set(existing_runs)
        self.gemini_reads = 0

    def select(self, table, params):
        if table == "automations":
            return self.autos
        if table == "messages":
            return [self.body]
        if table == "accounts":
            return self.accounts
        return []

    def first(self, table, params):
        if table == "contact_identities":
            return self.identities.get((params["kind"].removeprefix("eq."), (params.get("value") or "").removeprefix("eq.")))
        if table == "contacts":
            return self.contacts.get(params["id"].removeprefix("eq."), {})
        if table == "accounts":
            return self.accounts[0] if self.accounts else None
        if table == "drafts":
            return self.drafts[0] if self.drafts else None
        if table == "threads":
            return {"priority": "normal", "junk": True, "needs_reply": False}
        return None

    def count(self, table, params):
        return self.gemini_reads

    def insert(self, table, row):
        self.inserts.append((table, row))
        return [{**row, "id": f"{table}-{len(self.inserts)}"}]

    def insert_new(self, table, row, on_conflict):
        if table == "automation_runs":
            key = (row["automation_id"], row["message_id"])
            if key in self.runs:
                return []
            self.runs.add(key)
        if table == "contact_identities" and (row["kind"], row["value"].removeprefix("s:address:")) in self.identities:
            return []  # the database ignores a duplicate
        self.inserts.append((table, row))
        return [{**row, "id": f"{table}-{len(self.inserts)}"}]

    def update(self, table, filters, patch, minimal=False):
        self.updates.append((table, filters, patch))
        return [patch]

    def delete(self, table, filters):
        self.deletes.append((table, filters))

    def of(self, table):
        return [r for t, r in self.inserts if t == table]

    def run_patch(self):
        return next(p for t, f, p in reversed(self.updates) if t == "automation_runs")


def auto(spec, template="property24", enabled_at=None):
    return {"id": "a1", "user_id": USER, "template_key": template, "spec": FakeVault().seal(USER, "automation", json.dumps(spec)), "enabled_at": enabled_at or (NOW - timedelta(days=1)).isoformat()}


def message(sender="noreply@property24.com", subject="New Property24 Enquiry", channel="email", sent=None):
    return {
        "id": MESSAGE, "user_id": USER, "account_id": ACCOUNT, "thread_id": THREAD, "sender_address": sender, "subject": subject,
        "sent_at": (sent or NOW - timedelta(minutes=2)).isoformat(), "threads": {"channel": channel},
    }


def build(db, gemini=None):
    a = Automations(db, gemini or FakeGemini(), "model", FakeVault())
    a.doer.vault = a.vault
    return a


class LiveRun(unittest.TestCase):
    def test_a_property24_enquiry_becomes_a_lead_with_everything_the_automation_asks_for(self):
        db = FakeDb([auto(P24_SPEC)], {"id": MESSAGE, "body_text": fx.P24_PLAIN, "body_html": None})
        gemini = FakeGemini()
        self.assertEqual(build(db, gemini).after_triage([message()]), 1)
        self.assertEqual(gemini.calls, [], "the fixed parser reads a template: Gemini is not called")
        contact = db.of("contacts")[0]
        self.assertEqual(contact["display_name"], "s:name:Sipho Dlamini")
        self.assertEqual(contact["relationship"], "s:contact_relationship:Lead")
        self.assertEqual(contact["lead_source"], "s:lead_source:Property24 Enquiry")
        identities = {(r["kind"], r["value"]) for r in db.of("contact_identities")}
        self.assertEqual(identities, {("email", "s:address:sipho.dlamini@gmail.com"), ("phone", "s:address:+27821234567")})
        self.assertEqual(db.of("thread_participants")[0]["thread_id"], THREAD)
        task = db.of("task_updates")[0]
        self.assertEqual((task["action"], task["account_id"], task["priority"]), ("create", "todo1", 1))
        self.assertEqual(task["title"], "s:task_title:Call Back Within 5 Minutes: Sipho Dlamini")
        self.assertIn("+27821234567", task["notes"])
        draft = db.of("drafts")[0]
        self.assertEqual(draft["status"], "pending")
        self.assertEqual(draft["reply_to"], "s:address:sipho.dlamini@gmail.com", "addressed to the lead, never the portal")
        self.assertNotIn("property24.com", draft["reply_to"])
        self.assertIn("not to the portal", draft["instruction"])
        self.assertNotIn("is this still available", draft["instruction"], "the enquirer's own words never go into the instruction")
        self.assertIn(("threads", {"id": f"eq.{THREAD}", "user_id": f"eq.{USER}"}, {"priority": "urgent", "junk": False, "needs_reply": True}), db.updates)
        run = db.run_patch()
        self.assertEqual((run["status"], run["read_by"], run["error"]), ("done", "parser", None))
        self.assertEqual(json.loads(run["fields"].removeprefix("s:automation_run:"))["name"], "Sipho Dlamini")
        self.assertEqual(run["effects"]["contact_created"], True)
        self.assertEqual(run["effects"]["thread_before"], {"priority": "normal", "junk": True, "needs_reply": False})
        for table, _ in db.inserts:
            self.assertNotIn(table, ("outbox", "calendar_outbox"), "an automation never sends anything")

    def test_a_repeat_enquirer_joins_their_record_and_keeps_their_relationship(self):
        db = FakeDb(
            [auto(P24_SPEC)], {"id": MESSAGE, "body_text": fx.P24_PLAIN, "body_html": None},
            identities={("email", "sipho.dlamini@gmail.com"): {"contact_id": "c9"}},
            contacts={"c9": {"id": "c9", "relationship": "s:contact_relationship:Client", "lead_source": None}},
        )
        build(db).after_triage([message()])
        self.assertEqual(db.of("contacts"), [])
        self.assertEqual(db.run_patch()["contact_id"], "c9")
        self.assertFalse(db.run_patch()["effects"]["contact_created"])
        patch = next(p for t, f, p in db.updates if t == "contacts")
        self.assertNotIn("relationship", patch, "a client stays a client")
        self.assertEqual(patch["lead_source"], "s:lead_source:Property24 Enquiry")
        self.assertEqual([r["kind"] for r in db.of("contact_identities")], ["phone"], "their new number is added to the record")

    def test_a_message_is_never_run_twice(self):
        db = FakeDb([auto(P24_SPEC)], {"id": MESSAGE, "body_text": fx.P24_PLAIN, "body_html": None}, existing_runs=[("a1", MESSAGE)])
        self.assertEqual(build(db).after_triage([message()]), 0)
        self.assertEqual(db.of("contacts"), [])

    def test_an_existing_draft_is_not_replaced(self):
        db = FakeDb([auto(P24_SPEC)], {"id": MESSAGE, "body_text": fx.P24_PLAIN, "body_html": None}, drafts=[{"id": "d1"}])
        build(db).after_triage([message()])
        self.assertEqual(db.of("drafts"), [])

    def test_a_missing_task_list_fails_that_step_only(self):
        db = FakeDb([auto(P24_SPEC)], {"id": MESSAGE, "body_text": fx.P24_PLAIN, "body_html": None}, accounts=[])
        build(db).after_triage([message()])
        run = db.run_patch()
        self.assertEqual((run["status"], run["error"]), ("done", "task"))
        self.assertEqual(len(db.of("contacts")), 1)
        self.assertEqual(len(db.of("drafts")), 1)

    def test_mail_that_does_not_match_or_is_out_of_scope_is_left_alone(self):
        body = {"id": MESSAGE, "body_text": fx.P24_PLAIN, "body_html": None}
        cases = [
            message(sender="sam@gmail.com"),
            message(channel="whatsapp"),
            message(sent=NOW - timedelta(days=10)),
            message(sent=NOW - timedelta(days=2)),  # before the automation was turned on (enabled_at below)
        ]
        db = FakeDb([auto(P24_SPEC, enabled_at=(NOW - timedelta(days=1)).isoformat())], body)
        for m in cases:
            self.assertEqual(build(db).after_triage([m]), 0)
        self.assertEqual(db.inserts, [])

    def test_a_disabled_or_unreadable_automation_does_nothing(self):
        db = FakeDb([{**auto(P24_SPEC), "spec": "not json"}], {"id": MESSAGE, "body_text": fx.P24_PLAIN, "body_html": None})
        self.assertEqual(build(db).after_triage([message()]), 0)
        self.assertEqual(build(FakeDb([], {})).after_triage([message()]), 0)


class GeminiFallback(unittest.TestCase):
    def test_a_template_whose_parser_fails_asks_gemini_under_its_own_feature(self):
        changed = "Hello agent,\nSam Jones (sam@example.com, 082 111 2222) wants to know about 12 Oak Road.\nRegards\nenquiry"
        db = FakeDb([auto(P24_SPEC)], {"id": MESSAGE, "body_text": changed, "body_html": None})
        gemini = FakeGemini({"name": "Sam Jones", "email": "sam@example.com", "phone": "082 111 2222", "message": "", "listing_ref": "", "listing": "12 Oak Road", "price": ""})
        build(db, gemini).after_triage([message()])
        self.assertEqual([(f, u) for f, u, _ in gemini.calls], [("automations", USER)])
        self.assertIn("<<<UNTRUSTED-", gemini.calls[0][2])
        run = db.run_patch()
        self.assertEqual((run["status"], run["read_by"]), ("done", "gemini"))
        self.assertEqual(db.of("contacts")[0]["display_name"], "s:name:Sam Jones")

    def test_a_custom_automation_always_asks_gemini_for_its_own_fields(self):
        text = "Contact form\nFrom the website: Ayanda, ayanda@example.org, 0825550123. Wants a valuation."
        db = FakeDb([auto(CUSTOM_SPEC, template=None)], {"id": MESSAGE, "body_text": text, "body_html": None})
        gemini = FakeGemini({"name": "Ayanda", "email": "ayanda@example.org", "phone": "0825550123"})
        build(db, gemini).after_triage([message(sender="no-reply@forms.example.com", subject="Contact form")])
        self.assertEqual(len(gemini.calls), 1)
        self.assertEqual(db.run_patch()["read_by"], "gemini")
        self.assertEqual(db.of("contacts")[0]["lead_source"], "s:lead_source:Website Form")
        self.assertEqual(db.of("task_updates"), [], "no task was asked for")

    def test_gemini_is_not_asked_for_an_email_nobody_can_be_reached_from(self):
        db = FakeDb([auto(P24_SPEC)], {"id": MESSAGE, "body_text": fx.P24_NEWSLETTER.replace("support@property24.com", "") + "\nenquiry", "body_html": None})
        gemini = FakeGemini({"name": "x"})
        build(db, gemini).after_triage([message(subject="Property24 lead report")])
        self.assertEqual(gemini.calls, [])
        run = db.run_patch()
        self.assertEqual((run["status"], run["error"]), ("skipped", "unreadable"))
        self.assertEqual(db.of("contacts"), [])

    def test_the_daily_limit_stops_gemini_and_the_run_says_so(self):
        db = FakeDb([auto(CUSTOM_SPEC, template=None)], {"id": MESSAGE, "body_text": "Ayanda ayanda@example.org", "body_html": None})
        db.gemini_reads = engine_module.GEMINI_DAILY_CAP
        gemini = FakeGemini({"name": "Ayanda", "email": "ayanda@example.org"})
        build(db, gemini).after_triage([message(sender="x@forms.example.com")])
        self.assertEqual(gemini.calls, [])
        self.assertEqual(db.run_patch()["error"], "ai_daily_limit")

    def test_a_gemini_failure_is_recorded_not_raised(self):
        db = FakeDb([auto(CUSTOM_SPEC, template=None)], {"id": MESSAGE, "body_text": "Ayanda ayanda@example.org", "body_html": None})
        gemini = FakeGemini(error=GeminiError(429, "quota"))
        self.assertEqual(build(db, gemini).after_triage([message(sender="x@forms.example.com")]), 1)
        run = db.run_patch()
        self.assertEqual((run["status"], run["error"]), ("failed", "ai_unavailable"))
        self.assertEqual(db.of("contacts"), [])

    def test_an_invented_address_never_becomes_a_contact(self):
        db = FakeDb([auto(CUSTOM_SPEC, template=None)], {"id": MESSAGE, "body_text": "Ayanda wrote from ayanda@example.org", "body_html": None})
        gemini = FakeGemini({"name": "Ayanda", "email": "attacker@evil.example", "phone": ""})
        build(db, gemini).after_triage([message(sender="x@forms.example.com")])
        self.assertEqual(db.of("contacts"), [])
        self.assertEqual(db.run_patch()["status"], "skipped")


class Preview(unittest.TestCase):
    def items(self):
        def item(text, sender="noreply@property24.com", days=1):
            return {"account_id": ACCOUNT, "sender": sender, "subject": "New Property24 Enquiry", "sent_at": (NOW - timedelta(days=days)).isoformat(), "text": text, "links": []}
        return [item(fx.P24_PLAIN, days=3), item(fx.P24_PLAIN, days=1), item("Name: Thandi Nkosi\nEmail: thandi@example.co.za\nenquiry", days=2), item(fx.P24_NEWSLETTER + "enquiry"), item("enquiry", sender="x@gmail.com")]

    def test_a_template_preview_counts_people_not_emails_and_lists_them_newest_first(self):
        spec = parse_spec(P24_SPEC)
        out = summarise(spec, "property24", self.items(), set(), 5)
        self.assertEqual((out["mode"], out["matched"], out["unreadable"], out["count"]), ("parsed", 4, 1, 2))
        self.assertEqual([p["name"] for p in out["leads"]], ["Sipho Dlamini", "Thandi Nkosi"])
        self.assertEqual(out["leads"][0]["enquiries"], 2)
        self.assertEqual(out["leads"][0]["listing"], "3 Bedroom House in Sandton, Gauteng")

    def test_a_custom_preview_only_counts_matching_emails_and_spends_nothing(self):
        spec = parse_spec(CUSTOM_SPEC)
        items = [{**i, "sender": "x@forms.example.com"} for i in self.items()[:2]] + self.items()[4:]
        out = summarise(spec, None, items, set(), 3)
        self.assertEqual((out["mode"], out["matched"], out["count"]), ("matched", 2, 2))

    def test_the_preview_loop_claims_a_request_reads_the_window_and_writes_a_sealed_answer(self):
        class PreviewDb(FakeDb):
            def select(self, table, params):
                if table == "automation_previews":
                    return [{"id": "p1", "user_id": USER, "template_key": "property24", "spec": FakeVault().seal(USER, "automation", json.dumps(P24_SPEC))}]
                if table == "messages" and "body_text" not in params["select"]:
                    return [] if int(params["offset"]) else [{"id": MESSAGE, "account_id": ACCOUNT, "subject": "New Property24 Enquiry", "sender_address": "noreply@property24.com", "sent_at": NOW.isoformat()}]
                return super().select(table, params)

        db = PreviewDb([], {"id": MESSAGE, "body_text": fx.P24_PLAIN, "body_html": None})
        self.assertEqual(Previews(db, FakeVault()).run_once(), 1)
        statuses = [p.get("status") for t, f, p in db.updates if t == "automation_previews"]
        self.assertEqual(statuses, ["running", "done"])
        result = json.loads(db.updates[-1][2]["result"].removeprefix("s:automation_run:"))
        self.assertEqual((result["count"], result["leads"][0]["name"]), (1, "Sipho Dlamini"))
        self.assertEqual(db.of("contacts") + db.of("task_updates") + db.of("drafts"), [], "a preview makes nothing")


if __name__ == "__main__":
    unittest.main()
