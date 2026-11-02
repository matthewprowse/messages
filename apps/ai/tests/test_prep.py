"""Tests for ai.prep and ai.contact_facts: which events are due for a brief, how a person's brief is arranged from stored
summaries (no model), who counts as a guest, and that the brief is written sealed once per start time."""

import json
import unittest
from datetime import datetime, timedelta, timezone

import ai.prep as prep
from ai.contact_facts import Facts, MeetingFact, ThreadFact, ago_text, facts_lines, parse_actions, preferred_channel
from ai.fields import SUMMARY
from ai.prep import Prep, guest_emails, person_brief, prep_due

NOW = datetime(2026, 11, 20, 9, 0, tzinfo=timezone.utc)


def iso(minutes=0, days=0):
    return (NOW + timedelta(minutes=minutes, days=days)).isoformat()


def thread(subject, days, channel="email", mine=False, needs=False, waiting=False, summary=""):
    return ThreadFact("t", subject, summary, iso(days=-days), channel, mine, needs, waiting)


class Helpers(unittest.TestCase):
    def test_ago_text(self):
        self.assertEqual(ago_text(iso(), NOW), "today")
        self.assertEqual(ago_text(iso(days=-1), NOW), "yesterday")
        self.assertEqual(ago_text(iso(days=-9), NOW), "9 days ago")
        self.assertEqual(ago_text(None, NOW), "unknown")

    def test_parse_actions_is_forgiving(self):
        self.assertEqual(parse_actions('["Send the offer", " ", 3]'), ["Send the offer"])
        self.assertEqual(parse_actions("not json"), [])
        self.assertEqual(parse_actions('{"a": 1}'), [])

    def test_preferred_channel_counts_then_recency(self):
        ts = [thread("a", 1, "whatsapp"), thread("b", 2, "email"), thread("c", 3, "whatsapp")]
        self.assertEqual(preferred_channel(ts), "WhatsApp")
        self.assertEqual(preferred_channel([thread("a", 1, "email"), thread("b", 2, "whatsapp")]), "Email")  # tie: newest
        self.assertIsNone(preferred_channel([]))

    def test_facts_lines_carry_day_counts_and_state(self):
        f = Facts("c1", "Sam", about="Office manager at Acme.", threads=[thread("Quote", 9, needs=True, summary="Asked for a quote")])
        text = "\n".join(facts_lines(f, NOW))
        self.assertIn("Last activity: 9 days ago", text)
        self.assertIn("they are waiting on you", text)
        self.assertIn("Most used channel: Email", text)


class Brief(unittest.TestCase):
    def test_person_brief_arranges_stored_summaries(self):
        f = Facts(
            "c1", "Sam", about="Runs the Acme office.", role="Office Manager", company="Acme",
            threads=[
                thread("Lease", 1, needs=True, summary="Wants the lease by Friday"),
                thread("Invoice", 4, mine=True, waiting=True),
                thread("Hello", 8), thread("Old", 30),
            ],
            meetings=[MeetingFact("Kickoff", iso(days=-14), "Agreed scope", ["Send the signed offer"])],
        )
        b = person_brief(f, NOW)
        self.assertEqual(b["who"], "Office Manager at Acme")
        self.assertEqual(len(b["recent"]), 3)
        self.assertIn("Lease (Email, yesterday): Wants the lease by Friday", b["recent"][0])
        self.assertEqual(b["promises"][0], "You owe a reply: Lease (yesterday)")
        self.assertIn("Waiting on Sam: Invoice (4 days ago)", b["promises"])
        self.assertIn("From the last meeting: Send the signed offer", b["promises"])
        self.assertEqual(b["last_meeting"], "Kickoff (14 days ago): Agreed scope")
        self.assertEqual(b["asked"], "Wants the lease by Friday")

    def test_empty_person_still_has_a_shape(self):
        b = person_brief(Facts("c1", "Sam", about="Neighbour."), NOW)
        self.assertEqual((b["who"], b["recent"], b["promises"], b["last_meeting"], b["asked"]), ("Neighbour.", [], [], None, None))


class Due(unittest.TestCase):
    def event(self, id, minutes, **over):
        return {"id": id, "starts_at": iso(minutes), "all_day": False, "attendees": [{"email": "a@x.com"}], **over}

    def test_only_events_starting_within_thirty_minutes(self):
        events = [self.event("soon", 20), self.event("later", 45), self.event("started", -5), self.event("allday", 10, all_day=True), self.event("alone", 10, attendees=[])]
        self.assertEqual([e["id"] for e in prep_due(events, {}, NOW)], ["soon"])

    def test_built_once_per_start_and_again_when_moved(self):
        e = self.event("e", 20)
        self.assertEqual(prep_due([e], {"e": e["starts_at"]}, NOW), [])
        self.assertEqual(len(prep_due([e], {"e": iso(120)}, NOW)), 1)

    def test_guests_skip_self_and_resources(self):
        raw = [{"email": "Me@x.com", "self": True}, {"email": "Sam@X.com"}, {"email": "sam@x.com"}, {"email": "room@x.com", "resource": True}, {"name": "no email"}]
        self.assertEqual(guest_emails(raw), ["sam@x.com"])
        self.assertEqual(guest_emails(None), [])


class Vault:
    def keys_for(self, user_id):
        return object()

    def open(self, user_id, field, value):
        return value

    def seal(self, user_id, field, value):
        return f"sealed:{field}:{value}"


class Db:
    def __init__(self, events, identities=None):
        self.events, self.identities, self.upserts = events, identities or [], []

    def select(self, table, params):
        return {"calendar_events": self.events, "contact_identities": self.identities}.get(table, [])

    def upsert(self, table, rows, on_conflict):
        self.upserts.append((table, rows, on_conflict))


class RunOnce(unittest.TestCase):
    def setUp(self):
        self.original = (prep.address_index, prep.load_facts)
        prep.address_index = lambda keys, a: "idx"
        prep.load_facts = lambda *a: Facts("c1", "Sam", about="Neighbour.")
        self.event = {"id": "e", "user_id": "u", "starts_at": iso(10), "all_day": False, "attendees": [{"email": "a@x.com"}]}

    def tearDown(self):
        prep.address_index, prep.load_facts = self.original

    def test_nobody_known_writes_nothing_and_is_not_retried(self):
        db = Db([self.event])
        job = Prep(db, Vault())
        self.assertEqual(job.run_once(NOW), 0)
        self.assertEqual(db.upserts, [])
        self.assertEqual(len(job._empty), 1)

    def test_brief_is_sealed_under_summary(self):
        db = Db([self.event], [{"contact_id": "c1", "value_index": "idx"}])
        self.assertEqual(Prep(db, Vault()).run_once(NOW), 1)
        table, row, conflict = db.upserts[0]
        self.assertEqual((table, conflict), ("event_preps", "event_id"))
        self.assertTrue(row["brief"].startswith(f"sealed:{SUMMARY}:"))
        body = json.loads(row["brief"].split(":", 2)[2])
        self.assertEqual(body["people"][0]["name"], "Sam")


if __name__ == "__main__":
    unittest.main()
