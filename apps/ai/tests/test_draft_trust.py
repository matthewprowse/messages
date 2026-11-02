"""Trustworthy drafts: the fact guard (every number, date, time, address in a draft must be in what it was written from),
placeholder detection, the colder retry, the audit counts, thumbs feedback as a learning signal, per-channel style rules and
voice learning for WhatsApp, and the voice-note hint in the prompt."""

import json
import unittest
from datetime import datetime, timezone

from ai.drafts import RETRY_TEMPERATURE, Drafts
from ai.drafts_facts import calendar_lines, check, extract, needs_retry, placeholders, retry_note
from ai.drafts_feedback import down_lines, section, up_lines
from ai.drafts_gather import audit_of, evidence_of
from ai.drafts_prompt import VOICE_NOTE_NOTE, build_prompt
from ai.vault import Vault
from ai.voice import WHATSAPP_SYSTEM, Voice, build_prompt as voice_prompt, plan_voice, slot_of
from tests.test_company_voice import MASTER_B64, Db


def unsupported(draft, *context):
    return [f["text"] for f in check(draft, list(context))["facts"] if not f["found"]]


class Extraction(unittest.TestCase):
    def test_amounts_match_however_they_are_written(self):
        self.assertEqual(unsupported("The fee is R4,500.", "Quote: R 4 500"), [])
        self.assertEqual(unsupported("That comes to R4500.00", "it is 4,500 rand"), [])
        self.assertEqual(unsupported("It is R4,500.", "Quote: R4,800"), ["R4,500"])

    def test_times_match_across_styles(self):
        self.assertEqual(unsupported("See you at 14:00", "Can we do 2pm?"), [])
        self.assertEqual(unsupported("See you at 14h30", "Is 2.30pm fine?"), [])
        self.assertEqual(unsupported("See you at 15:00", "Can we do 2pm?"), ["15:00"])

    def test_dates_match_by_day_and_month(self):
        self.assertEqual(unsupported("Let us meet on 5 November.", "How about November 5th?"), [])
        self.assertEqual(unsupported("Due 2026-11-05", "by the 5th of Nov"), [])
        self.assertEqual(unsupported("Due 12 December", "by the 5th of Nov"), ["12 December"])
        self.assertEqual(unsupported("On 3/11 then", "the 3rd of November"), [])

    def test_weekdays_come_from_the_conversation_or_the_calendar(self):
        self.assertEqual(unsupported("Friday works", "can we do Friday?"), [])
        self.assertEqual(unsupported("Friday works", "can we meet soon?"), ["Friday"])
        lines = calendar_lines([{"starts_at": "2026-11-06T08:00:00+00:00", "ends_at": "2026-11-06T09:00:00+00:00"}], "Africa/Johannesburg", datetime(2026, 11, 2, tzinfo=timezone.utc))
        self.assertEqual(lines, ["Friday 6 November, 10:00 to 11:00"])
        self.assertEqual(unsupported("Friday at 10:00 works", *lines), [])

    def test_phones_emails_and_links(self):
        self.assertEqual(unsupported("Call 082 555 1234 or mail Sam@Example.com", "My number: +27 82 555 1234, sam@example.com"), [])
        self.assertEqual(unsupported("Call 082 555 9999", "My number: +27 82 555 1234"), ["082 555 9999"])
        self.assertEqual(unsupported("See https://www.acme.co.za/fees/.", "http://acme.co.za/fees"), [])
        self.assertEqual(unsupported("See acme.co.za/fees via https://evil.example/x", "http://acme.co.za/fees"), ["https://evil.example/x"])

    def test_a_phone_number_is_not_also_read_as_numbers(self):
        kinds = [f.kind for f in extract("Call 082 555 1234 at 10:00")]
        self.assertEqual(kinds, ["phone", "time"])

    def test_small_numbers_and_years_are_not_flagged(self):
        self.assertEqual(unsupported("Two options, point 3, in 2026", "nothing here"), [])
        self.assertEqual(unsupported("About 250 people", "nothing here"), ["250"])

    def test_the_instruction_and_saved_facts_count_as_context(self):
        evidence = evidence_of({"facts": [("Fees", "Deposit R2,000")], "about_note": "", "them": "Sam", "me": ""}, ["Hi"], {"instruction": "Tell him Monday", "decision": None}, "Quote", [])
        self.assertEqual(unsupported("Deposit R2,000, Monday", *evidence), [])


class Placeholders(unittest.TestCase):
    def test_placeholders_are_found(self):
        self.assertEqual(placeholders("Hi [Name], total {amount} TODO <First Name>"), ["[Name]", "{amount}", "<First Name>", "TODO"])
        self.assertEqual(placeholders("As agreed [1] and mail <a@b.com>"), [])
        self.assertEqual(placeholders("Plain reply, thanks."), [])

    def test_a_placeholder_counts_against_the_draft(self):
        report = check("Hi [Name], thanks", [])
        self.assertEqual(report["missing"], 1)
        self.assertTrue(needs_retry(report))
        self.assertFalse(needs_retry(check("Hi, thanks", [])))
        self.assertIn("[Name]", retry_note(report))


class Recording:
    """Answers the given bodies in turn and remembers the temperature of each call."""

    def __init__(self, *bodies):
        self.bodies = list(bodies)
        self.calls = []

    def json(self, model, system, prompt, schema, usage, **kw):
        self.calls.append({"prompt": prompt, "temperature": kw.get("temperature")})
        return {"body": self.bodies.pop(0) if len(self.bodies) > 1 else self.bodies[0]}


def write(*bodies):
    db = Db(None)
    gemini = Recording(*bodies)
    drafts = Drafts(db, gemini, "m", None, Vault(db, MASTER_B64, True))
    drafts._write(db.draft)
    done = next(patch for table, _, patch in db.updates if table == "drafts" and "body" in patch)
    return gemini, done


def opened(sealed):
    return json.loads(Vault(Db(None), MASTER_B64, True).open("u", "draft", sealed))


class Retry(unittest.TestCase):
    def test_an_invented_amount_is_asked_again_at_a_lower_temperature(self):
        gemini, done = write("It is R4,500.", "It is still available.")
        self.assertEqual(len(gemini.calls), 2)
        self.assertGreater(gemini.calls[0]["temperature"], RETRY_TEMPERATURE)
        self.assertEqual(gemini.calls[1]["temperature"], RETRY_TEMPERATURE)
        self.assertIn("R4,500", gemini.calls[1]["prompt"])
        self.assertEqual(opened(done["report"])["missing"], 0, "the second, clean try is the one reported")
        self.assertEqual(done["audit"]["messages"], 1)

    def test_a_clean_draft_is_asked_once(self):
        gemini, done = write("It is still available.")
        self.assertEqual(len(gemini.calls), 1)
        self.assertIsNotNone(done["report"])

    def test_the_better_try_is_kept_and_a_bad_second_try_is_not(self):
        _, done = write("Hi [Name], R4,500 and 14:00.", "Hi [Name], R4,500.")
        self.assertEqual(opened(done["report"])["missing"], 2, "two problems beat three")
        _, done = write("Hi, R4,500.", "Hi [Name], R4,500 and 14:00.")
        self.assertEqual(opened(done["report"])["missing"], 1, "a worse second try is not used")

    def test_a_placeholder_is_asked_again_too(self):
        gemini, _ = write("Hi [Name], yes.", "Hi, yes.")
        self.assertEqual(len(gemini.calls), 2)


class Audit(unittest.TestCase):
    def test_counts_only(self):
        a = audit_of({"facts": [("a", "b")], "rules": ["x", "y"], "person_rules": [], "similar": [("i", "r")], "more_voice": [], "recent": ["z"], "about_note": "n"}, 3, True)
        self.assertEqual(a, {"messages": 3, "facts": 1, "rules": 2, "replies": 2, "note": True, "calendar": True})


class Feedback(unittest.TestCase):
    drafts = [
        {"feedback": "down", "feedback_reason": "too_formal", "body": "Dear Sir, I trust you are well."},
        {"feedback": "down", "feedback_reason": "wrong_facts", "body": "It is R9."},
        {"feedback": "down", "feedback_reason": None, "body": "Hmm."},
        {"feedback": "up", "body": "Sure, Friday works."},
        {"feedback": None, "body": "ignored"},
    ]

    def test_style_downs_are_kept_and_fact_downs_are_not(self):
        self.assertEqual(down_lines(self.drafts), [("too formal", "Dear Sir, I trust you are well."), ("not good enough", "Hmm.")])
        self.assertEqual(up_lines(self.drafts), ["Sure, Friday works."])

    def test_the_section_names_why(self):
        text = "\n".join(section(self.drafts))
        self.assertIn("--- Why: too formal", text)
        self.assertIn("thumbs up", text)

    def test_signals_prompt_carries_it(self):
        from ai.signals import build_prompt as signals_prompt

        self.assertIn("Why: too formal", signals_prompt([], [], [], None, self.drafts))
        self.assertNotIn("thumbs", signals_prompt([], [], [], None, None))


class Channels(unittest.TestCase):
    def test_other_channel_rules_are_left_out_of_a_draft(self):
        class Rules(Db):
            def select(self, table, params):
                if table == "style_rules":
                    return [{"rule": "Opens with Dear"}] if params["channel"] == "eq.email" else []
                return super().select(table, params)

        db = Rules(None)
        drafts = Drafts(db, Recording("x"), "m", None, Vault(db, MASTER_B64, True))
        rules = [{"rule": "Opens with Dear"}, {"rule": "Keeps it short"}]
        self.assertEqual(drafts._channel_rules("u", "whatsapp", rules), [{"rule": "Keeps it short"}])
        self.assertEqual(drafts._channel_rules("u", "email", rules), rules)

    def test_rules_are_kept_when_they_cannot_be_checked(self):
        class Broken(Db):
            def select(self, table, params):
                if table == "style_rules":
                    raise RuntimeError("down")
                return super().select(table, params)

        db = Broken(None)
        drafts = Drafts(db, Recording("x"), "m", None, Vault(db, MASTER_B64, True))
        self.assertEqual(drafts._channel_rules("u", "whatsapp", [{"rule": "a"}]), [{"rule": "a"}])

    def test_whatsapp_learning_leaves_email_rules_alone(self):
        existing = [
            {"id": "e", "rule": "Signs off Kind regards", "scope": "global", "source": "sent_mail", "enabled": True, "channel": "email"},
            {"id": "w", "rule": "Uses emoji", "scope": "global", "source": "sent_mail", "enabled": True, "channel": "whatsapp"},
            {"id": "a", "rule": "Keeps it short", "scope": "global", "source": "signals", "enabled": True, "channel": "any"},
        ]
        updates, inserts = plan_voice(existing, ["Keeps it short", "Writes lowercase"], "whatsapp")
        self.assertEqual(dict(updates), {"a": {"support_count": 2}, "w": {"enabled": False, "disabled_reason": "unsupported"}})
        self.assertEqual(inserts, ["Writes lowercase"])
        self.assertEqual(plan_voice(existing[:1], ["Signs off Kind regards"], "email")[0], [("e", {"support_count": 2})])

    def test_the_whatsapp_prompt_is_about_chat(self):
        self.assertIn("WhatsApp", WHATSAPP_SYSTEM)
        self.assertIn("--- Message 1:\nsup", voice_prompt(["sup"], [], None, "whatsapp"))
        self.assertIn("Messages they sent", voice_prompt(["sup"], [], None, "whatsapp"))
        self.assertEqual(slot_of("u", "email"), "u")
        self.assertEqual(slot_of("u", "whatsapp"), "u:whatsapp")

    def test_whatsapp_is_learned_on_its_own_counters(self):
        class Fake:
            def __init__(self):
                self.inserted, self.profile_patch, self.system = [], None, None
                self.profile_selects = []

            def first(self, table, params):
                self.profile_selects.append(params["select"])
                return {"voice_whatsapp_learned_at": None, "voice_whatsapp_learned_outbound": 0}

            def count(self, table, params):
                return 12

            def select(self, table, params):
                if table == "messages":
                    return [{"body_text": f"hey {i}", "body_html": None} for i in range(12)]
                return []

            def insert(self, table, rows):
                self.inserted += rows
                return rows

            def update(self, table, filters, patch, minimal=False):
                if table == "profiles":
                    self.profile_patch = patch

        class Gem:
            system = None

            def json(self, model, system, prompt, schema, usage, **kw):
                Gem.system = system
                return {"rules": [{"rule": "Writes lowercase"}]}

        db = Fake()
        self.assertTrue(Voice(db, Gem(), "m")._learn("u", ["a1"], "whatsapp"))
        self.assertEqual(Gem.system, WHATSAPP_SYSTEM)
        self.assertEqual(db.profile_selects, ["voice_whatsapp_learned_at,voice_whatsapp_learned_outbound"])
        self.assertEqual(set(db.profile_patch), {"voice_whatsapp_learned_at", "voice_whatsapp_learned_outbound"})
        self.assertEqual(db.inserted[0]["channel"], "whatsapp")


class VoiceNotes(unittest.TestCase):
    def prompt(self, voice_note):
        return build_prompt(me="Sam", about="", rules=[], examples=[], recent=[], them="Thandi", relationship="client", style_note="", conversation=[("Thandi", "(Voice note) hi, three things")], tone="default", instruction=None, voice_note=voice_note)

    def test_a_voice_note_asks_for_every_point_in_its_language(self):
        self.assertIn(VOICE_NOTE_NOTE, self.prompt(True))
        self.assertNotIn(VOICE_NOTE_NOTE, self.prompt(False))
        self.assertIn("language they spoke", VOICE_NOTE_NOTE)


if __name__ == "__main__":
    unittest.main()
