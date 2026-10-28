"""Company voice (step 6 of Teams): the team's profile, templates and facts reach a draft only in a work chat (or a shared
inbox chat), under the person's own style, and never in a personal chat. The AI allowance still decides whether a draft
is written at all."""

import base64
import os
import unittest

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ai.company_voice import COMPANY_FACT_CHARS, COMPANY_FACTS_CHARS, COMPANY_SYSTEM, RULE_LINES, TEMPLATES_CHARS, pick_company
from ai.crypto import derive_team_keys, derive_user_keys, encrypt_field, encrypt_team_field
from ai.drafts import SYSTEM, Drafts, build_prompt
from ai.fields import BODY, HTML, NOTE, NOTE_TITLE, STYLE_RULE, SUBJECT, WRITING_BODY, WRITING_SITUATION
from ai.gemini import Gemini, GeminiError
from ai.vault import Vault

MASTER = os.urandom(32)
MASTER_B64 = base64.b64encode(MASTER).decode()
USER_KEY, TEAM_KEY = os.urandom(32), os.urandom(32)
USER, TEAM = derive_user_keys(USER_KEY), derive_team_keys(TEAM_KEY)
WORKSPACE = "w1"


def wrapped(key: bytes, aad: str) -> dict:
    iv = os.urandom(12)
    return {"wrapped_key": base64.b64encode(iv + AESGCM(MASTER).encrypt(iv, key, aad.encode())).decode(), "wrapped_by": "local:v1"}


def team(field: str, text: str) -> str:
    return encrypt_team_field(TEAM, field, text)


def item(kind, slot=None, title=None, body="", fields=None):
    t, b = fields
    return {"kind": kind, "slot": slot, "title": team(t, title) if title is not None else None, "body": team(b, body)}


VOICE = [
    item("fact", title="Office hours", body="8 to 5 on weekdays, closed on public holidays", fields=(NOTE_TITLE, NOTE)),
    item("profile", slot="tone", body="Warm and plain, never pushy", fields=(None, STYLE_RULE)),
    item("profile", slot="sign_off", body="Kind regards, Acme Properties", fields=(None, STYLE_RULE)),
    item("profile", slot="always", body="Mention our FSP number 12345\n- Offer a viewing", fields=(None, STYLE_RULE)),
    item("profile", slot="never", body="Promise a price before a viewing", fields=(None, STYLE_RULE)),
    item("template", title="Viewing request", body="Thanks for your interest. When would suit you to view it?", fields=(WRITING_SITUATION, WRITING_BODY)),
]
SECRETS = ["8 to 5 on weekdays", "Warm and plain", "Kind regards, Acme Properties", "FSP number 12345", "Promise a price", "Viewing request", "When would suit you"]


class Db:
    """The draft context of one conversation, the user's and team's keys, and what company_voice_for_draft would answer."""

    def __init__(self, voice=None, member=True, work=True, draft=None):
        self.voice = voice
        self.member = member
        self.work = work
        self.draft = draft or {"id": "d1", "user_id": "u", "thread_id": "t1", "tone": "default", "instruction": "Say Friday works"}
        self.rpcs: list[str] = []
        self.updates: list[tuple[str, dict, dict]] = []
        self.usage: list[dict] = []
        self.allowance = {"used_pct": 10, "features": {"draft": 10}, "week_features": {}}
        self.voice_error = False

    def first(self, table, params):
        if table == "user_keys":
            return wrapped(USER_KEY, "user_keys:u")
        return None

    def select(self, table, params):
        if table == "drafts":
            return [self.draft]
        if table == "team_keys":
            return [wrapped(TEAM_KEY, f"team_keys:{WORKSPACE}")]
        if table == "workspace_members":
            return [{"workspace_id": WORKSPACE}] if self.member else []
        return []

    def rpc(self, function, args):
        self.rpcs.append(function)
        if function == "company_voice_for_draft":
            if self.voice_error:
                raise RuntimeError("down")
            return {"workspace_id": WORKSPACE, "items": self.voice} if self.work and self.voice is not None else None
        if function == "ai_allowance_for":
            return self.allowance
        if function == "ai_setup_state":
            return {"accounts": 0, "allowance": 0, "spent": 0}
        if function == "ai_allowance_shares_for":
            raise RuntimeError("no such function")
        if function != "draft_context":
            return []
        return {
            "thread": {"id": "t1", "user_id": "u", "account_id": "a1", "subject": encrypt_field(USER, SUBJECT, "Viewing"), "channel": "email"},
            "messages": [{"id": "m1", "direction": "inbound", "sender_contact_id": None, "subject": None, "body_text": None,
                          "body_html": encrypt_field(USER, HTML, "<p>Is the flat still available?</p>"), "sent_at": "2026-10-20T10:00:00+00:00"}],
            "profile": {"display_name": "Sipho", "about": None},
            "rules": [{"rule": encrypt_field(USER, STYLE_RULE, "Always open with Hi"), "scope": "global", "contact_id": None}],
            "examples": [{"situation": encrypt_field(USER, "writing_situation", "A client asks"), "body": encrypt_field(USER, "writing_body", "Hi Thandi, sure, shot")}],
            "recent": [{"body_text": encrypt_field(USER, BODY, "Cheers, Sipho"), "body_html": None}],
            "contact": None,
            "to_them": [],
            "choices": None,
        }

    def insert(self, table, row):
        self.usage.append(row)
        return []

    def update(self, table, filters, patch, minimal=False):
        self.updates.append((table, filters, patch))
        return [{"id": "d1"}]


class Recording:
    def __init__(self):
        self.calls: list[tuple[str, str, object]] = []

    def json(self, model, system, prompt, schema, usage, **kw):
        self.calls.append((system, prompt, usage))
        return {"body": "Hi, it is still available."}


def run(db, gemini=None, model="m"):
    gemini = gemini or Recording()
    drafts = Drafts(db, gemini, model, None, Vault(db, MASTER_B64, True))
    drafts._write(db.draft)
    return drafts, gemini


class WorkChats(unittest.TestCase):
    def test_a_work_chat_draft_carries_the_company_voice_opened(self):
        db = Db(VOICE)
        _, g = run(db)
        [(system, prompt, usage)] = g.calls
        self.assertIn("company_voice_for_draft", db.rpcs)
        for text in SECRETS:
            self.assertIn(text, prompt)
        self.assertNotIn("t1:", prompt)
        self.assertNotIn("e1:", prompt)
        self.assertIn("- Tone: Warm and plain, never pushy", prompt)
        self.assertIn("- Sign-off: Kind regards, Acme Properties", prompt)
        self.assertIn("- Offer a viewing", prompt, "a leading dash on a line is not doubled")
        self.assertNotIn("- - ", prompt)
        self.assertEqual(system, SYSTEM + COMPANY_SYSTEM)
        self.assertEqual((usage.user_id, usage.feature, usage.thread_id), ("u", "draft", "t1"), "filed against the person, as any draft")

    def test_the_agents_own_style_comes_first_and_the_company_before_the_examples(self):
        _, g = run(Db(VOICE))
        prompt = g.calls[0][1]
        own_rule = prompt.index("Always open with Hi")
        company = prompt.index("How the business they work for writes")
        facts = prompt.index("Company facts")
        example = prompt.index("Hi Thandi, sure, shot")
        recent = prompt.index("Cheers, Sipho")
        self.assertLess(own_rule, company)
        self.assertLess(company, facts)
        self.assertLess(facts, example)
        self.assertLess(example, recent)
        self.assertLess(recent, prompt.index("The conversation, oldest first"))
        self.assertIn("Their own style wins on wording", g.calls[0][0])
        self.assertIn("The business wins on content", g.calls[0][0])

    def test_a_personal_chat_gets_none_of_it(self):
        db = Db(VOICE, work=False)  # a chat with no workspace: the database answers null
        _, g = run(db)
        [(system, prompt, _)] = g.calls
        for text in SECRETS:
            self.assertNotIn(text, prompt)
        self.assertNotIn("business", prompt.lower())
        self.assertEqual(system, SYSTEM, "the system text is exactly what it was before teams")
        self.assertIn("company_voice_for_draft", db.rpcs, "asked, and the database said no")

    def test_a_personal_prompt_is_the_same_as_before_teams(self):
        _, g = run(Db(VOICE, work=False))
        _, plain = run(Db(None, member=False))
        self.assertEqual(g.calls[0][1], plain.calls[0][1])

    def test_a_worker_that_is_handed_items_without_a_workspace_uses_none(self):
        db = Db(VOICE)
        db.rpc_orig = db.rpc
        db.rpc = lambda function, args: {"workspace_id": None, "items": VOICE} if function == "company_voice_for_draft" else db.rpc_orig(function, args)
        _, g = run(db)
        for text in SECRETS:
            self.assertNotIn(text, g.calls[0][1])
        self.assertEqual(g.calls[0][0], SYSTEM)

    def test_someone_in_no_team_never_asks(self):
        db = Db(VOICE, member=False)
        _, g = run(db)
        self.assertNotIn("company_voice_for_draft", db.rpcs, "no extra round trip for a personal user")
        self.assertEqual(g.calls[0][0], SYSTEM)

    def test_edits_and_adjustments_do_not_use_it(self):
        for tone in ("edit", "shorter"):
            db = Db(VOICE, draft={"id": "d1", "user_id": "u", "thread_id": "t1", "tone": tone, "source": encrypt_field(USER, "draft", "Hi, still avaliable"), "instruction": None})
            _, g = run(db)
            self.assertNotIn("company_voice_for_draft", db.rpcs)
            for text in SECRETS:
                self.assertNotIn(text, g.calls[0][1])

    def test_a_new_message_has_no_work_chat_so_it_has_none(self):
        db = Db(VOICE)
        d = Drafts(db, Recording(), "m", None, Vault(db, MASTER_B64, True))
        db.rpc = lambda function, args: {"account": {"id": "a1", "user_id": "u", "channel": "email"}, "profile": None, "rules": [], "examples": [], "recent": [], "to_them": [], "facts": []} if function == "compose_context" else db.rpcs.append(function)
        got = d._gather_compose({"id": "d1", "user_id": "u", "account_id": "a1", "contact_id": None, "tone": "default", "instruction": "Tell them hello", "audio_path": None})
        self.assertNotIn("company_voice_for_draft", db.rpcs)
        self.assertNotIn("business", got["prompt"].lower())

    def test_a_voice_that_cannot_be_read_does_not_stop_the_draft(self):
        db = Db(VOICE)
        db.voice_error = True
        _, g = run(db)
        self.assertEqual(len(g.calls), 1)
        self.assertEqual(g.calls[0][0], SYSTEM)

    def test_values_that_cannot_be_opened_are_left_out(self):
        other = derive_team_keys(os.urandom(32))
        broken = [{**VOICE[0], "body": encrypt_team_field(other, NOTE, "Wrong key")}, VOICE[1]]
        _, g = run(Db(broken))
        prompt = g.calls[0][1]
        self.assertNotIn("Wrong key", prompt)
        self.assertNotIn("Office hours", prompt)
        self.assertIn("Warm and plain", prompt)

    def test_an_empty_voice_changes_nothing(self):
        _, g = run(Db([]))
        self.assertEqual(g.calls[0][0], SYSTEM)


class Shape(unittest.TestCase):
    def opened(self, field, value):
        from ai.crypto import decrypt_team_field

        return decrypt_team_field(TEAM, field, value)

    def test_it_is_trimmed_to_a_small_stable_size(self):
        many = [item("fact", title=f"F{i}", body="x" * 2000, fields=(NOTE_TITLE, NOTE)) for i in range(20)]
        many += [item("template", title=f"T{i}", body="y" * 2000, fields=(WRITING_SITUATION, WRITING_BODY)) for i in range(20)]
        many.append(item("profile", slot="always", body="\n".join(f"rule {i} " + "z" * 500 for i in range(40)), fields=(None, STYLE_RULE)))
        c = pick_company(many, self.opened)
        self.assertLessEqual(sum(len(b) for _, b in c["facts"]), COMPANY_FACTS_CHARS)
        self.assertTrue(all(len(b) <= COMPANY_FACT_CHARS for _, b in c["facts"]))
        self.assertLessEqual(sum(len(b) for _, b in c["templates"]), TEMPLATES_CHARS)
        self.assertEqual(len(c["always"]), RULE_LINES)
        self.assertTrue(all(len(r) <= 200 for r in c["always"]))

    def test_nothing_in_it_is_none(self):
        self.assertIsNone(pick_company([], self.opened))
        self.assertIsNone(pick_company([item("profile", slot="tone", body="  ", fields=(None, STYLE_RULE))], self.opened))

    def test_without_it_the_prompt_is_unchanged(self):
        base = dict(me="Sipho", about="", rules=[], examples=[], recent=[], them="", relationship="", style_note="", conversation=[("Them", "Hi")], tone="default", instruction=None)
        self.assertEqual(build_prompt(**base), build_prompt(**base, company=None))
        self.assertNotIn("business", build_prompt(**base).lower())


class StubGemini(Gemini):
    """The real allowance check and usage recording, with no network."""

    called = 0

    def _call(self, model, body, endpoint="", *, attempts=4, timeout=90, stats=None):
        StubGemini.called += 1
        self.sent = body
        return {"candidates": [{"content": {"parts": [{"text": '{"body": "It is still available."}'}]}}], "usageMetadata": {"promptTokenCount": 900, "candidatesTokenCount": 40}}


class Allowance(unittest.TestCase):
    def setUp(self):
        StubGemini.called = 0

    def test_a_work_chat_draft_is_still_stopped_when_the_allowance_is_used_up(self):
        db = Db(VOICE)
        db.allowance = {"used_pct": 100, "features": {"draft": 100}, "week_features": {}}
        gemini = StubGemini("key", db)
        run(db, gemini)
        self.assertEqual(StubGemini.called, 0, "the model is never called")
        [(table, _, patch)] = [u for u in db.updates if u[0] == "drafts" and u[2].get("status") == "failed"]
        self.assertEqual(patch["error"], "The draft could not be written. Try again.")
        self.assertFalse([u for u in db.updates if u[2].get("status") == "active"])
        gemini.close()
        self.assertEqual(db.usage, [])

    def test_with_room_it_is_written_and_the_cost_is_filed_as_a_draft(self):
        db = Db(VOICE)
        gemini = StubGemini("key", db)
        run(db, gemini, "gemini-3.8-flash")
        self.assertEqual(StubGemini.called, 1)
        self.assertIn("8 to 5 on weekdays", gemini.sent["contents"][0]["parts"][0]["text"])
        self.assertIn("The business wins on content", gemini.sent["systemInstruction"]["parts"][0]["text"])
        gemini.close()
        [row] = db.usage
        self.assertEqual((row["user_id"], row["feature"]), ("u", "draft"))
        self.assertGreater(row["cost_usd"], 0)
        self.assertTrue([u for u in db.updates if u[2].get("status") == "active"])

    def test_an_unreadable_allowance_stops_it_too(self):
        db = Db(VOICE)
        original = db.rpc

        def rpc(function, args):
            if function == "ai_allowance_for":
                raise RuntimeError("down")
            return original(function, args)

        db.rpc = rpc
        gemini = StubGemini("key", db)
        run(db, gemini)
        self.assertEqual(StubGemini.called, 0)
        with self.assertRaises(GeminiError):
            gemini.json("gemini-3.5-flash-lite", "s", "p", {}, __import__("ai.gemini", fromlist=["UsageContext"]).UsageContext("u", "draft"))


if __name__ == "__main__":
    unittest.main()
