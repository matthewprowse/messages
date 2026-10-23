import gzip
import http.server
import json
import threading
import unittest
from datetime import date, datetime, timedelta, timezone
from typing import Any

from ai.drafts import build_prompt as draft_prompt
from ai.drafts import pick_drafts, pick_more_voice, pick_similar, pick_voice
from ai.embed import PREFIX, Embeddings as EmbeddingStore, embed_text, embedding_rows, queue_row, vector_literal
from ai.gemini import Gemini, GeminiError, UsageContext, error_reason, normalise, read_usage, retry_wait
from ai.http import Pool
from ai.supabase import SupabaseError, missing_relation
from ai.learn import edit_ratio, rewrite_pairs
from ai.people import RESCAN_S, orgs_due, people_due, person_prompt, scan_due, sent_counts
from ai.pricing import cost_usd
from ai.signals import TONE_RULES, plan_signals, tone_counts
from ai.text import clean
from ai.triage import SYSTEM as TRIAGE_SYSTEM
from ai.triage import Triage, UserContext, apply_signals, groups, known_outcome, latest_incoming, matches, pending_query, read_results, triage_prompt
from ai.retry import MAX_WAIT_S, Backoff, not_in
from ai.voice import PROMPT_CHARS, build_prompt, plan_voice, tidy_rule, voice_due


def _days_ago(days: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


class Pricing(unittest.TestCase):
    def test_flash_price_doubles_in_2027(self):
        self.assertAlmostEqual(cost_usd("gemini-3.8-flash", date(2026, 10, 22), 1_000_000, 0, 1_000_000), 4.50)
        self.assertAlmostEqual(cost_usd("gemini-3.8-flash", date(2027, 1, 1), 1_000_000, 0, 1_000_000), 9.00)

    def test_cached_tokens_are_cheaper(self):
        self.assertAlmostEqual(cost_usd("gemini-3.5-flash-lite", date(2026, 10, 22), 1_000_000, 1_000_000, 0), 0.03)

    def test_unknown_model_costs_nothing(self):
        self.assertEqual(cost_usd("mystery", date(2026, 10, 22), 1000, 0, 1000), 0.0)

    def test_thinking_counts_as_output(self):
        u = read_usage("gemini-3.5-flash-lite", {"promptTokenCount": 1000, "candidatesTokenCount": 100, "thoughtsTokenCount": 50}, datetime(2026, 10, 22, tzinfo=timezone.utc))
        self.assertEqual((u.input_tokens, u.output_tokens), (1000, 150))
        self.assertAlmostEqual(u.cost_usd, (1000 * 0.30 + 150 * 2.50) / 1_000_000, places=6)


class Text(unittest.TestCase):
    def test_quotes_and_footers_are_cut(self):
        body = "Hi,\n\nSounds good.\n\nGet Outlook for iOS<https://aka.ms/x>\n________________________________\nFrom: A <a@x.com>\nSent: Tue\n\nold"
        self.assertEqual(clean(body), "Hi,\n\nSounds good.")

    def test_html_only(self):
        self.assertEqual(clean(None, "<p>Hello <b>there</b></p><style>x{}</style>"), "Hello  there")


class Signals(unittest.TestCase):
    def base(self, **kw):
        return {"priority": "normal", "category": "fyi", "junk": False, "needs_reply": True, "summary": "x", **kw}

    def test_rule_matching(self):
        self.assertTrue(matches("ceo@acme.com", ["acme.com"]))
        self.assertTrue(matches("ceo@mail.acme.com", ["@acme.com"]))
        self.assertFalse(matches("ceo@notacme.com", ["acme.com"]))

    def test_unsubscribed_is_junk(self):
        out = apply_signals(self.base(), "news@shop.com", UserContext(unsubscribed={"news@shop.com"}), [])
        self.assertEqual((out["junk"], out["priority"], out["needs_reply"]), (True, "low", False))

    def test_always_important_beats_junk(self):
        out = apply_signals(self.base(junk=True), "boss@work.com", UserContext(always=["work.com"]), [])
        self.assertEqual((out["junk"], out["priority"]), (False, "important"))

    def test_latest_correction_wins(self):
        out = apply_signals(self.base(junk=True), "a@b.com", UserContext(), ["not_junk", "junk"])
        self.assertFalse(out["junk"])


class Learning(unittest.TestCase):
    def test_edit_ratio(self):
        self.assertEqual(edit_ratio("Thanks, see you then", "Thanks, see you then"), 0.0)
        self.assertGreater(edit_ratio("Dear Sir, I would be delighted.", "Cool, works for me. Matt"), 0.8)


class Voice(unittest.TestCase):
    def test_prompt_lists_rules_then_emails_within_budget(self):
        prompt = build_prompt(["Hi Sam, works for me. Matt", "x" * PROMPT_CHARS], ["Signs off with Matt"])
        self.assertIn("- Signs off with Matt", prompt)
        self.assertIn("--- Email 1:\nHi Sam, works for me. Matt", prompt)
        self.assertNotIn("Email 2", prompt)
        self.assertLessEqual(len(prompt), PROMPT_CHARS)

    def test_prompt_without_rules(self):
        self.assertIn("Existing rules:\n(none)", build_prompt(["Thanks"], []))

    def test_same_wording_gains_support(self):
        existing = [
            {"id": "a", "rule": "Signs off with Matt.", "scope": "global", "contact_id": None, "source": "sent_mail", "support_count": 2, "enabled": True},
            {"id": "b", "rule": "Keeps it short", "scope": "contact", "contact_id": "c1", "source": "edits", "support_count": 1, "enabled": True},
        ]
        updates, inserts = plan_voice(existing, ["signs off  with Matt", "Keeps it short", "Keeps it short", "", "y" * 201])
        self.assertEqual(updates, [("a", {"support_count": 3})])
        self.assertEqual(inserts, ["Keeps it short"])  # the contact rule is not a global match

    def test_close_wording_is_the_same_rule(self):
        existing = [{"id": "a", "rule": "Signs off with Matt", "scope": "global", "source": "sent_mail", "support_count": 1, "enabled": True}]
        updates, inserts = plan_voice(existing, ["Signs off with 'Matt'"])
        self.assertEqual((updates, inserts), ([("a", {"support_count": 2})], []))

    def test_unsupported_sent_mail_rules_are_turned_off_not_others(self):
        existing = [
            {"id": "a", "rule": "Opens with Hey", "scope": "global", "source": "sent_mail", "enabled": True},
            {"id": "b", "rule": "Never uses exclamation marks", "scope": "global", "source": "edits", "enabled": True},
            {"id": "c", "rule": "Writes in British English", "scope": "global", "source": "sent_mail", "enabled": False, "disabled_reason": "unsupported"},
        ]
        updates, inserts = plan_voice(existing, ["Uses short paragraphs"])
        self.assertEqual(updates, [("a", {"enabled": False, "disabled_reason": "unsupported"})])
        self.assertEqual(inserts, ["Uses short paragraphs"])

    def test_supported_again_comes_back_but_yours_stay_off(self):
        existing = [
            {"id": "a", "rule": "Opens with Hey", "scope": "global", "source": "sent_mail", "enabled": False, "disabled_reason": "unsupported"},
            {"id": "b", "rule": "Signs off with Matt", "scope": "global", "source": "sent_mail", "enabled": False, "disabled_reason": "user"},
        ]
        updates, inserts = plan_voice(existing, ["Opens with Hey", "Signs off with Matt"])
        self.assertEqual(dict(updates), {"a": {"support_count": 2, "enabled": True}, "b": {"support_count": 2}})
        self.assertEqual(inserts, [])

    def test_due_every_ten_sent(self):
        self.assertFalse(voice_due(9, 0, None))
        self.assertTrue(voice_due(10, 0, None))
        self.assertFalse(voice_due(29, 20, "2026-10-01T00:00:00Z"))
        self.assertTrue(voice_due(30, 20, "2026-10-01T00:00:00Z"))

    def test_turned_off_rules_are_listed(self):
        self.assertIn("Rules they turned off:\n- Uses emojis", build_prompt(["Hi"], [], ["Uses emojis"]))

    def test_dashes_are_removed(self):
        self.assertEqual(tidy_rule("Short replies \u2014 two lines"), "Short replies, two lines")
        self.assertEqual(tidy_rule("Writes 9\u20135"), "Writes 9-5")


class DraftVoice(unittest.TestCase):
    def test_this_person_first_then_recent_up_to_six(self):
        to_them = [{"body_text": "To Sam"}]
        recent = [{"body_text": "To Sam"}] + [{"body_text": f"Note {i}"} for i in range(8)] + [{"body_text": ""}]
        self.assertEqual(pick_voice(to_them, recent), ["To Sam", "Note 0", "Note 1", "Note 2", "Note 3", "Note 4"])

    def test_limit_and_skip(self):
        recent = [{"body_text": "Similar reply"}, {"body_text": "A"}, {"body_text": "B"}]
        self.assertEqual(pick_voice([], recent, limit=1, skip=["Similar reply"]), ["A"])
        self.assertEqual(pick_voice([], recent, limit=0), [])


class Similar(unittest.TestCase):
    def row(self, thread, similarity, reply="Thanks, Friday works.", inbound="Can we meet Friday?"):
        return {"thread_id": thread, "similarity": similarity, "reply_text": reply, "inbound_text": inbound, "inbound_subject": "Meeting"}

    def test_other_conversations_close_enough_one_each(self):
        rows = [self.row("now", 0.99), self.row("t1", 0.95), self.row("t1", 0.9), self.row("t2", 0.5), self.row("t3", 0.8, reply="")]
        rows.append(self.row("t4", 0.75, inbound=""))
        self.assertEqual(pick_similar(rows, "now"), [("Can we meet Friday?", "Thanks, Friday works."), ("Meeting", "Thanks, Friday works.")])

    def test_prompt_shows_pairs_and_who(self):
        prompt = draft_prompt(
            me="Matt", about="", them="Sam", relationship="", style_note="", who_they_are="Sam runs the venue.", similar=[("Can we meet?", "Sure.")],
            rules=[], examples=[], recent=[], conversation=[("Sam", "Hi")], tone="default", instruction=None,
        )
        self.assertIn("Who this person is: Sam runs the venue.", prompt)
        self.assertIn("--- They received:\nCan we meet?\n--- They replied:\nSure.", prompt)


class Embeddings(unittest.TestCase):
    def test_text_and_literal(self):
        self.assertEqual(embed_text("Hello", "Body\n\nOn Tue, A wrote:\n> old", None), PREFIX + "Hello\n\nBody")
        self.assertEqual(embed_text(None, None, None), PREFIX + "(no text)")
        self.assertEqual(vector_literal([0.5, -0.25]), "[0.500000,-0.250000]")

    def test_normalise(self):
        self.assertEqual(normalise([3.0, 4.0]), [0.6, 0.8])
        self.assertEqual(normalise([0.0, 0.0]), [0.0, 0.0])


class TriageQuery(unittest.TestCase):
    def test_only_threads_with_triage_on(self):
        q = pending_query("2026-10-01T00:00:00Z")
        self.assertIn("threads!inner(triage_enabled)", q["select"])
        self.assertEqual(q["threads.triage_enabled"], "eq.true")
        self.assertEqual(q["message_ai"], "is.null")


class Retry(unittest.TestCase):
    def test_waits_double_and_are_capped(self):
        b = Backoff()
        self.assertEqual(b.failed("a", 0), 1)
        self.assertEqual(b.waiting(30), ["a"])
        self.assertEqual(b.waiting(61), [])  # one minute after the first failure
        b.failed("a", 61)
        self.assertEqual(b.waiting(61 + 119), ["a"])  # two minutes after the second
        for _ in range(20):
            b.failed("a", 0)
        self.assertEqual(b.waiting(MAX_WAIT_S - 1), ["a"])
        self.assertEqual(b.waiting(MAX_WAIT_S + 1), [])

    def test_success_clears_and_filter(self):
        b = Backoff()
        b.failed("a", 0)
        b.succeeded("a")
        self.assertEqual((b.failures("a"), b.waiting(1)), (0, []))
        self.assertEqual(not_in([]), {})
        self.assertEqual(not_in(["x", "y"]), {"id": "not.in.(x,y)"})

    def test_failed_messages_are_left_out_of_triage(self):
        q = pending_query("2026-10-01", ["m1", "m2"])
        self.assertEqual(q["id"], "not.in.(m1,m2)")
        self.assertNotIn("id", pending_query("2026-10-01"))


class SignalRules(unittest.TestCase):
    def drafts(self, tones):
        return [{"tone": t} for t in tones]

    def test_tone_habits(self):
        self.assertEqual(tone_counts(self.drafts(["shorter"] * 3 + ["default"] * 5)), {"shorter": 3})
        self.assertEqual(tone_counts(self.drafts(["shorter"] * 3 + ["default"] * 8)), {})  # under 30%
        self.assertEqual(tone_counts(self.drafts(["custom"] * 5)), {})

    def test_tone_rule_added_updated_and_turned_off(self):
        updates, inserts = plan_signals([], {"shorter": 4}, None)
        self.assertEqual((updates, inserts), ([], [(TONE_RULES["shorter"], 4)]))
        existing = [
            {"id": "s", "rule": TONE_RULES["shorter"], "support_count": 4, "enabled": False, "disabled_reason": "unsupported"},
            {"id": "f", "rule": TONE_RULES["formal"], "support_count": 3, "enabled": True},
            {"id": "x", "rule": "Leaves out the sign-off", "support_count": 1, "enabled": True},
        ]
        updates, inserts = plan_signals(existing, {"shorter": 5}, None)
        self.assertEqual(dict(updates), {"s": {"enabled": True, "support_count": 5}, "f": {"enabled": False, "disabled_reason": "unsupported"}})
        self.assertEqual(inserts, [])  # x is left alone when the model was not asked

    def test_instruction_rules_follow_the_model(self):
        existing = [
            {"id": "x", "rule": "Leaves out the sign-off", "support_count": 1, "enabled": True},
            {"id": "y", "rule": "Mentions the deadline", "support_count": 2, "enabled": True},
        ]
        updates, inserts = plan_signals(existing, {}, ["Leaves out the sign-off.", "Uses bullet points for lists", TONE_RULES["casual"]])
        self.assertEqual(dict(updates), {"x": {"support_count": 2}, "y": {"enabled": False, "disabled_reason": "unsupported"}})
        self.assertEqual(inserts, [("Uses bullet points for lists", 1)])


class PeopleNotes(unittest.TestCase):
    def test_sent_counts_skip_own_and_count_once(self):
        outbound = [
            {"to_addresses": ["sam@x.com", "sam@work.com", "me@me.com"], "sent_at": "2026-10-01T00:00:00Z"},
            {"to_addresses": ["SAM@x.com"], "sent_at": "2026-10-02T00:00:00Z"},
            {"to_addresses": ["me@me.com"], "sent_at": "2026-10-03T00:00:00Z"},
        ]
        ids = {"sam@x.com": "c1", "sam@work.com": "c1", "me@me.com": "c-me"}
        self.assertEqual(sent_counts(outbound, ids, {"me@me.com"}), {"c1": ["2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"]})

    def test_older_mail_counts_for_the_conversation(self):
        outbound = [{"thread_id": "t1", "to_addresses": [], "sent_at": "2026-10-01T00:00:00Z"}]
        self.assertEqual(sent_counts(outbound, {}, set(), {"t1": ["c1", "c-me"]}, {"c-me"}), {"c1": ["2026-10-01T00:00:00Z"]})

    def test_people_due(self):
        times = [f"2026-10-0{d}T00:00:00Z" for d in range(1, 8)]
        sent = {"new": times[:3], "fresh": times[:3], "stale": times[:3], "few": times[:2]}
        contacts = [
            {"id": "fresh", "style_updated_at": "2026-10-01T12:00:00Z"},  # 2 sent + 3 inbound since: due
            {"id": "stale", "style_updated_at": "2026-10-06T12:00:00Z"},
            {"id": "new", "style_updated_at": None},
            {"id": "few", "style_updated_at": None},
        ]
        inbound = {"fresh": times[4:], "stale": times[4:]}
        self.assertEqual(people_due(sent, contacts, inbound), ["new", "fresh"])

    def test_orgs_due(self):
        orgs = [
            {"id": "a", "summary": None, "summary_updated_at": None},
            {"id": "b", "summary": "Bank.", "summary_updated_at": "2026-09-01T00:00:00Z"},
            {"id": "c", "summary": None, "summary_updated_at": None},
            {"id": "d", "summary": "Shop.", "summary_updated_at": "2026-09-01T00:00:00Z"},
            {"id": "e", "summary": "Airline.", "summary_updated_at": _days_ago(2)},
        ]
        mail = {"a": ["2026-10-02T00:00:00Z"], "b": ["2026-10-02T00:00:00Z"] * 20, "d": ["2026-10-02T00:00:00Z"] * 19, "e": [_days_ago(1)] * 30}
        # d has too few new emails, e was summarised too recently: what a company sends rarely changes.
        self.assertEqual(orgs_due(orgs, mail), ["a", "b"])

    def test_person_notes_wait_a_few_days(self):
        times = [_days_ago(1)] * 6
        contacts = [{"id": "recent", "style_updated_at": _days_ago(2)}, {"id": "older", "style_updated_at": _days_ago(4)}]
        self.assertEqual(people_due({"recent": times, "older": times}, contacts, {}), ["older"])

    def test_scan_only_when_something_changed(self):
        self.assertTrue(scan_due(None, "t1", 0))
        self.assertFalse(scan_due(("t1", 0, False), "t1", 60))
        self.assertTrue(scan_due(("t1", 0, False), "t2", 60))  # new mail
        self.assertTrue(scan_due(("t1", 0, True), "t1", 60))  # more were due than one run did
        self.assertTrue(scan_due(("t1", 0, False), "t1", RESCAN_S))

    def test_future_dated_mail_does_not_keep_notes_due(self):
        orgs = [{"id": "b", "summary": "Bank.", "summary_updated_at": "2026-10-01T00:00:00Z"}]
        self.assertEqual(orgs_due(orgs, {"b": ["2999-01-01T00:00:00Z"] * 5}), [])

    def test_person_prompt_keeps_newest_within_budget(self):
        emails = [("Sam", "Old", "x" * 20000), ("Me", "New", "See you then")]
        prompt = person_prompt("Sam", {"style_note": "Brief", "summary": ""}, emails)
        self.assertIn("style_note: Brief", prompt)
        self.assertIn("--- Me, subject: New\nSee you then", prompt)
        self.assertNotIn("Old", prompt)


class Rewrites(unittest.TestCase):
    def test_reply_after_thrown_away_draft(self):
        discarded = [
            {"id": "d1", "thread_id": "t1", "created_at": "2026-10-01T10:00:00Z"},
            {"id": "d2", "thread_id": "t2", "created_at": "2026-10-01T10:00:00Z"},
            {"id": "d3", "thread_id": "t3", "created_at": "2026-10-01T10:00:00Z"},
        ]
        outbound = [
            {"id": "m0", "thread_id": "t1", "sent_at": "2026-10-01T09:00:00Z"},
            {"id": "m1", "thread_id": "t1", "sent_at": "2026-10-01T11:00:00Z"},
            {"id": "m2", "thread_id": "t2", "sent_at": "2026-10-01T12:00:00Z"},
            {"id": "m3", "thread_id": "t3", "sent_at": "2026-10-09T12:00:00Z"},
        ]
        thread_drafts = [{"id": "d2b", "thread_id": "t2", "created_at": "2026-10-01T11:00:00Z"}]
        self.assertEqual([(d["id"], m["id"]) for d, m in rewrite_pairs(discarded, outbound, thread_drafts)], [("d1", "m1")])


class TriageDecisions(unittest.TestCase):
    def test_signals_that_settle_it_without_the_model(self):
        ctx = UserContext(unsubscribed={"news@shop.com"})
        self.assertEqual(known_outcome({"sender_address": "News@Shop.com", "subject": "Sale"}, ctx, [])["category"], "newsletter")
        marked = known_outcome({"sender_address": "a@b.com", "subject": "Hi"}, UserContext(), ["important", "junk", "not_junk"])
        self.assertEqual((marked["junk"], marked["priority"], marked["category"], marked["summary"]), (True, "low", "fyi", "Hi"))
        self.assertIsNone(known_outcome({"sender_address": "a@b.com"}, UserContext(), ["not_junk", "junk"]))  # latest says Not Junk
        self.assertIsNone(known_outcome({"sender_address": "a@b.com"}, UserContext(), ["important"]))

    def test_latest_incoming_per_conversation(self):
        rows = [  # newest first
            {"id": "out1", "thread_id": "t1", "direction": "outbound"},
            {"id": "m2", "thread_id": "t1", "direction": "inbound"},
            {"id": "m1", "thread_id": "t1", "direction": "inbound"},
            {"id": "m3", "thread_id": "t2", "direction": "inbound"},
        ]
        batch = [{"id": "m1", "thread_id": "t1"}, {"id": "m2", "thread_id": "t1"}, {"id": "m3", "thread_id": "t2"}, {"id": "m4", "thread_id": "t3"}]
        self.assertEqual(latest_incoming(rows, batch), {"m1": (False, False), "m2": (True, False), "m3": (True, True), "m4": None})

    def test_prompt_puts_what_is_known_about_them_first(self):
        email = {"name": "Sam", "sender": "sam@x.com", "relationship": "", "known": True, "bulk": False, "subject": "Lunch", "body": "Free Friday?"}
        a = triage_prompt(UserContext(about="Runs a cafe"), [email])
        b = triage_prompt(UserContext(about="Runs a cafe"), [email, {**email, "subject": "Other"}])
        self.assertTrue(a.startswith("About them: Runs a cafe"))
        self.assertTrue(b.startswith(a))  # the same start, which Gemini bills at the cached rate when it repeats
        self.assertIn("=== Email 2\nFrom: Sam <sam@x.com>", b)
        self.assertIn("They have written to this sender before: yes", a)

    def test_results_by_number(self):
        got = read_results(
            {"results": [
                {"email": 2, "priority": "low", "category": "fyi", "junk": True, "needs_reply": False, "summary": "b"},
                {"email": 1, "priority": "urgent", "category": "work", "junk": False, "needs_reply": True, "summary": "a"},
                {"email": 1, "priority": "low", "category": "fyi", "junk": True, "needs_reply": False, "summary": "again"},
                {"email": 5, "priority": "low", "category": "fyi", "junk": True, "needs_reply": False, "summary": "no such email"},
                {"email": 3, "priority": "low", "summary": "no junk answer"},
            ]},
            3,
        )
        self.assertEqual(sorted(got), [1, 2])
        self.assertEqual((got[1]["summary"], got[2]["junk"]), ("a", True))
        self.assertEqual(read_results({"results": "nope"}, 2), {})

    def test_groups_per_account_and_size(self):
        ms = [{"id": str(i), "user_id": "u", "account_id": "a" if i < 10 else "b"} for i in range(12)]
        self.assertEqual([len(g) for g in groups(ms, 8)], [8, 2, 2])
        self.assertTrue(all(len({m["account_id"] for m in g}) == 1 for g in groups(ms, 8)))

    def test_system_prompt_has_no_dashes(self):
        self.assertNotIn("\u2014", TRIAGE_SYSTEM)
        self.assertNotIn("\u2013", TRIAGE_SYSTEM)


class FakeTriageDb:
    """Just enough PostgREST for Triage.run_once."""

    def __init__(self, pending, thread_messages, twins=None, feedback=None, accounts=("acc1",)):
        self.pending, self.thread_messages, self.twins = pending, thread_messages, twins or []
        self.thread_feedback = feedback or []
        self.accounts = accounts
        self.upserts: list[Any] = []
        self.thread_updates: dict[str, dict] = {}
        self.body_reads: list[str] = []

    def select(self, table, params):
        sel = params.get("select", "")
        if table == "messages":
            if "message_ai(message_id)" in sel:
                return self.pending
            if "message_ai!inner" in sel:
                return self.twins
            if sel == "id,thread_id,direction":
                return self.thread_messages
            if sel == "id,body_text,body_html":
                self.body_reads.append(params["id"])
                return [{"id": m["id"], "body_text": "Body of " + m["id"], "body_html": None} for m in self.pending]
            return []
        if table == "feedback":
            return [] if "threads(subject)" in sel else self.thread_feedback
        if table == "accounts":
            return [{"id": a} for a in self.accounts]
        return []

    def first(self, table, params):
        return None

    def upsert(self, table, rows, on_conflict):
        self.upserts.append((table, rows))

    def update(self, table, filters, patch, minimal=False):
        self.thread_updates[filters["id"][3:]] = patch
        return []


class FakeTriageGemini:
    def __init__(self):
        self.calls: list[tuple[str, UsageContext, dict]] = []

    def json(self, model, system, prompt, schema, usage, **kw):
        self.calls.append((prompt, usage, kw))
        n = prompt.count("=== Email ")
        return {"results": [{"email": i, "priority": "important", "category": "work", "junk": False, "needs_reply": True, "summary": f"s{i}"} for i in range(1, n + 1)]}


class TriageRun(unittest.TestCase):
    def msg(self, mid, thread, account="acc1", **kw):
        return {"id": mid, "user_id": "u", "account_id": account, "thread_id": thread, "provider_message_id": f"<{mid}@x>", "subject": f"Subject {mid}",
                "sender_address": "sam@x.com", "sender_contact_id": None, "list_unsubscribe": None, "sent_at": "2026-10-20T10:00:00+00:00", **kw}

    def test_one_call_for_the_latest_of_each_conversation(self):
        pending = [self.msg("m3", "t2"), self.msg("m2", "t1"), self.msg("m1", "t1")]
        rows = [{"id": "m3", "thread_id": "t2", "direction": "inbound"}, {"id": "m2", "thread_id": "t1", "direction": "inbound"},
                {"id": "m1", "thread_id": "t1", "direction": "inbound"}]
        db, gemini = FakeTriageDb(pending, rows), FakeTriageGemini()
        self.assertEqual(Triage(db, gemini, "fast").run_once(), 3)
        self.assertEqual(len(gemini.calls), 1)  # m1 is older than m2 in the same conversation: no model call for it
        prompt, usage, kw = gemini.calls[0]
        self.assertEqual(prompt.count("=== Email "), 2)
        self.assertEqual((usage.feature, usage.account_id, usage.thread_id, kw["thinking"]), ("triage", "acc1", None, "minimal"))
        [(table, written)] = db.upserts
        by_id = {r["message_id"]: r for r in written}
        self.assertEqual((table, by_id["m1"]["model"], by_id["m2"]["model"]), ("message_ai", None, "fast"))
        self.assertEqual(sorted(db.thread_updates), ["t1", "t2"])
        self.assertTrue(db.thread_updates["t1"]["needs_reply"])

    def test_junk_conversation_and_twins_skip_the_model(self):
        pending = [self.msg("m1", "t1"), self.msg("m2", "t2", account="acc2", provider_message_id="<same@x>"),
                   self.msg("m3", "t3", provider_message_id="<same@x>")]
        rows = [{"id": m["id"], "thread_id": m["thread_id"], "direction": "inbound"} for m in pending]
        twins = [{"user_id": "u", "provider_message_id": "<same@x>",
                  "message_ai": {"priority": "low", "category": "newsletter", "summary": "Sale", "needs_reply": False, "junk": True, "model": "fast"}}]
        db = FakeTriageDb(pending, rows, twins=twins, feedback=[{"thread_id": "t1", "value": "junk"}], accounts=("acc1", "acc2"))
        gemini = FakeTriageGemini()
        self.assertEqual(Triage(db, gemini, "fast").run_once(), 3)
        self.assertEqual(gemini.calls, [])
        by_id = {r["message_id"]: r for r in db.upserts[0][1]}
        self.assertEqual((by_id["m1"]["junk"], by_id["m1"]["model"]), (True, None))
        self.assertEqual((by_id["m2"]["summary"], by_id["m3"]["junk"]), ("Sale", True))
        self.assertEqual(db.body_reads, [])  # no bodies read when the model is not asked

    def test_same_email_twice_in_a_batch_is_asked_once(self):
        pending = [self.msg("m1", "t1", provider_message_id="<same@x>"), self.msg("m2", "t2", account="acc2", provider_message_id="<same@x>")]
        rows = [{"id": m["id"], "thread_id": m["thread_id"], "direction": "inbound"} for m in pending]
        db, gemini = FakeTriageDb(pending, rows, accounts=("acc1", "acc2")), FakeTriageGemini()
        self.assertEqual(Triage(db, gemini, "fast").run_once(), 2)
        self.assertEqual(len(gemini.calls), 1)
        self.assertEqual({r["summary"] for r in db.upserts[0][1]}, {"s1"})

    def test_a_group_the_model_will_not_answer_is_asked_one_by_one(self):
        pending = [self.msg("m1", "t1"), self.msg("m2", "t2")]
        rows = [{"id": m["id"], "thread_id": m["thread_id"], "direction": "inbound"} for m in pending]

        class Picky(FakeTriageGemini):
            def json(self, model, system, prompt, schema, usage, **kw):
                if "Body of m2" in prompt:
                    self.calls.append((prompt, usage, kw))
                    raise GeminiError(None, "no candidates")
                return super().json(model, system, prompt, schema, usage, **kw)

        db, gemini = FakeTriageDb(pending, rows), Picky()
        triage = Triage(db, gemini, "fast")
        self.assertEqual(triage.run_once(), 1)
        self.assertEqual(len(gemini.calls), 3)  # the pair, then each alone
        self.assertEqual([r["message_id"] for r in db.upserts[0][1]], ["m1"])
        self.assertEqual(triage._backoff.failures("m2"), 1)


class DraftOrder(unittest.TestCase):
    def prompt(self, **kw):
        base = dict(me="Matt", about="Runs a cafe", rules=["Signs off with Matt"], examples=[], recent=["Cheers, Matt"], them="Sam",
                    relationship="friend", style_note="", conversation=[("Sam", "Lunch?")], tone="default", instruction=None)
        return draft_prompt(**{**base, **kw})

    def test_another_tone_repeats_all_but_the_end(self):
        a, b = self.prompt(), self.prompt(tone="shorter", instruction="Say yes")
        common = len(a.split("Tone:")[0])
        self.assertEqual(a[:common], b[:common])
        self.assertLess(a.index("Signs off with Matt"), a.index("Replying to: Sam"))
        self.assertLess(a.index("Cheers, Matt"), a.index("Replying to: Sam"))

    def test_person_rules_and_voice_come_after_you(self):
        p = self.prompt(person_rules=["Calls him mate"], more_voice=["Hey Sam"])
        self.assertLess(p.index("Replying to: Sam"), p.index("Rules for writing to this person:\n- Calls him mate"))
        self.assertLess(p.index("Hey Sam"), p.index("The conversation, oldest first:"))

    def test_unknown_recipient_is_greeted_without_a_name(self):
        p = self.prompt(them="", recent=["Hi Norman,"])
        self.assertIn("Replying to: someone whose name is not known. Greet them without a name", p)

    def test_more_voice(self):
        recent = [{"body_text": f"Note {i}"} for i in range(8)]
        shown = ["Note 0", "Note 1", "Note 2"]
        # Nobody else to learn from: topped up to six in all, as before.
        self.assertEqual(pick_more_voice([], recent, shown=shown, similar=[]), ["Note 3", "Note 4", "Note 5"])
        # Their emails to this person come first and are kept even when similar replies fill the rest.
        to_them = [{"body_text": "To Sam 1"}, {"body_text": "Note 0"}, {"body_text": "To Sam 2"}]
        similar = [("q", "Note 3"), ("q", "x"), ("q", "y")]
        self.assertEqual(pick_more_voice(to_them, recent, shown=shown, similar=similar), ["To Sam 1", "To Sam 2"])

    def test_pick_drafts_one_per_conversation_oldest_first(self):
        pending = [{"id": "d1", "thread_id": "t1"}, {"id": "d2", "thread_id": "t1"}, {"id": "d3", "thread_id": "t2"}, {"id": "d4", "thread_id": "t3"},
                   {"id": "d5", "thread_id": "t4"}]
        self.assertEqual([d["id"] for d in pick_drafts(pending, {}, 3)], ["d1", "d3", "d4"])
        self.assertEqual([d["id"] for d in pick_drafts(pending, {"d0": "t2"}, 4)], ["d1", "d4", "d5"])


class GeminiErrors(unittest.TestCase):
    def test_retry_wait(self):
        body = json.dumps({"error": {"status": "RESOURCE_EXHAUSTED", "details": [{"@type": "x.RetryInfo", "retryDelay": "37s"}]}}).encode()
        self.assertEqual(retry_wait(body, {}), 37.0)
        self.assertEqual(retry_wait(b"{}", {"retry-after": "5"}), 5.0)
        self.assertIsNone(retry_wait(b"not json", {}))
        self.assertEqual(error_reason(b'{"error": {"status": "INVALID_ARGUMENT", "message": "bad thinking level"}}'), ("INVALID_ARGUMENT", "bad thinking level"))

    def test_minimal_thinking_falls_back_to_low(self):
        class FakeDb:
            def insert(self, table, row):
                return []

        class Stub(Gemini):
            def __init__(self):
                super().__init__("key", FakeDb())
                self.levels = []

            def _call(self, model, body, endpoint="", *, attempts=4, timeout=90):
                level = body["generationConfig"]["thinkingConfig"]["thinkingLevel"]
                self.levels.append(level)
                if level == "minimal":
                    raise GeminiError(400, "INVALID_ARGUMENT", "Thinking level minimal is not supported")
                return {"candidates": [{"content": {"parts": [{"text": '{"ok": true}'}]}}], "usageMetadata": {"promptTokenCount": 10}}

        g = Stub()
        ctx = UsageContext("u", "triage")
        self.assertEqual(g.json("m", "s", "p", {}, ctx, thinking="minimal", max_output=100), {"ok": True})
        self.assertEqual(g.json("m", "s", "p", {}, ctx, thinking="minimal"), {"ok": True})
        self.assertEqual(g.levels, ["minimal", "low", "low"])  # asked once, then remembered


class CachedUsage(unittest.TestCase):
    def test_cached_tokens_are_billed_at_the_cached_rate(self):
        u = read_usage("gemini-3.8-flash", {"promptTokenCount": 2000, "cachedContentTokenCount": 1500, "candidatesTokenCount": 100}, datetime(2026, 10, 22, tzinfo=timezone.utc))
        self.assertEqual((u.input_tokens, u.cached_tokens, u.output_tokens), (2000, 1500, 100))
        self.assertAlmostEqual(u.cost_usd, (500 * 0.75 + 1500 * 0.075 + 100 * 3.75) / 1_000_000, places=6)


class EmbeddingStorage(unittest.TestCase):
    def test_rows(self):
        rows = embedding_rows([{"id": "m1", "user_id": "u", "sent_at": "t"}], [[0.5, -0.25]])
        self.assertEqual(rows, [{"message_id": "m1", "user_id": "u", "sent_at": "t", "embedding": "[0.500000,-0.250000]"}])
        flat = queue_row({"message_id": "m1", "user_id": "u", "sent_at": "t", "messages": {"account_id": "a", "subject": "Hi"}})
        self.assertEqual(flat, {"id": "m1", "user_id": "u", "sent_at": "t", "account_id": "a", "subject": "Hi"})

    def test_missing_relation(self):
        self.assertTrue(missing_relation(SupabaseError(404, "PGRST205")))
        self.assertTrue(missing_relation(SupabaseError(400, "42703")))
        self.assertFalse(missing_relation(SupabaseError(500, None)))
        self.assertFalse(missing_relation(ValueError()))

    def _store(self, new_table: bool):
        calls = []

        class Db:
            def select(self, table, params):
                calls.append(("select", table))
                if table == "message_embeddings" and not new_table:
                    raise SupabaseError(404, "PGRST205")
                if table == "message_embeddings":
                    return [{"message_id": "m1", "user_id": "u", "sent_at": "t", "messages": {"account_id": "a", "subject": "Hi", "body_text": "x", "body_html": None}}]
                return [{"id": "m1", "user_id": "u", "account_id": "a", "sent_at": "t", "subject": "Hi", "body_text": "x", "body_html": None}]

            def upsert(self, table, rows, on_conflict):
                calls.append(("upsert", table, len(rows)))

            def update(self, table, filters, patch, minimal=False):
                calls.append(("update", table))
                return []

        class Gem:
            def embed(self, model, texts, usage):
                return [[1.0] + [0.0] * 767 for _ in texts]

        return EmbeddingStore(Db(), Gem(), "e"), calls

    def test_new_table_is_one_write(self):
        store, calls = self._store(True)
        self.assertEqual(store.run_once(), 1)
        self.assertEqual(calls, [("select", "message_embeddings"), ("upsert", "message_embeddings", 1)])

    def test_falls_back_to_messages_before_the_migration(self):
        store, calls = self._store(False)
        self.assertEqual(store.run_once(), 1)
        self.assertEqual(calls, [("select", "message_embeddings"), ("select", "messages"), ("update", "messages")])
        calls.clear()
        store.run_once()  # remembers for a while instead of asking for the table every time
        self.assertEqual(calls[0], ("select", "messages"))


class _Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    ports: list[int] = []
    close_after: bool = False

    def do_GET(self):
        _Handler.ports.append(self.client_address[1])
        body = gzip.compress(b"hello") if "gzip" in (self.headers.get("Accept-Encoding") or "") else b"hello"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        if body != b"hello":
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        self.wfile.write(body)
        if _Handler.close_after:
            self.close_connection = True  # closes without saying so, as an idle server does

    def log_message(self, *args):
        pass


class KeepAlive(unittest.TestCase):
    def setUp(self):
        _Handler.ports, _Handler.close_after = [], False
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/x"
        self.pool = Pool()

    def tearDown(self):
        self.pool.close()
        self.server.shutdown()
        self.server.server_close()

    def test_reuses_the_connection_and_unzips(self):
        self.assertEqual([self.pool.request("GET", self.url).body for _ in range(3)], [b"hello"] * 3)
        self.assertEqual(len(set(_Handler.ports)), 1)

    def test_reconnects_when_the_server_closed_it(self):
        _Handler.close_after = True
        self.assertEqual([self.pool.request("GET", self.url).status for _ in range(3)], [200] * 3)
        self.assertEqual(len(set(_Handler.ports)), 3)


class NotInColumn(unittest.TestCase):
    def test_column(self):
        self.assertEqual(not_in(["a"], "message_id"), {"message_id": "not.in.(a)"})


if __name__ == "__main__":
    unittest.main()
