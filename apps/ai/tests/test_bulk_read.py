"""Readable Bulk Email: bulk_read_text.py (links offered, figures checked, plain output) and bulk_read.py (claiming a
request, reading the email, storing the result or an error). Fakes stand in for Supabase and Gemini."""

from __future__ import annotations

import json
import unittest
from typing import Any

from ai.bulk_read import BulkRead, FAILED, PAUSED, UNREADABLE
from ai.bulk_read_text import SYSTEM, check_answer, extract_links, grounded, plain, prompt, readable_text
from ai.gemini import GeminiError

EMAIL = """Winter Sale starts Friday 30 October
Up to 40% off everything. Prices from R499.

Shop the sale (https://shop.example.com/sale?utm=abc)
Track your order https://shop.example.com/orders/12345
Unsubscribe (https://shop.example.com/unsubscribe?u=1)
Follow us https://www.instagram.com/shop
"""


class Links(unittest.TestCase):
    def test_real_links_only_without_leaving_social_or_settings(self):
        links = extract_links(EMAIL)
        self.assertEqual([l["url"] for l in links], ["https://shop.example.com/sale?utm=abc", "https://shop.example.com/orders/12345"])
        self.assertEqual(links[0]["context"], "Shop the sale")
        self.assertEqual(links[0]["host"], "shop.example.com")

    def test_a_link_alone_on_its_line_takes_the_line_above_as_context(self):
        links = extract_links("Read the full story\nhttps://news.example.com/a/1\n")
        self.assertEqual(links[0]["context"], "Read the full story")

    def test_repeats_are_dropped_and_the_list_is_capped(self):
        text = "\n".join(f"Item {i} https://x.example.com/{i}" for i in range(30)) + "\nItem 0 https://x.example.com/0"
        self.assertEqual(len(extract_links(text)), 12)
        self.assertEqual(len(extract_links("a https://x.example.com/1\nb https://x.example.com/1")), 1)

    def test_only_links_on_the_senders_own_site_are_offered(self):
        from ai.bulk_read_text import own_links, sender_site, site_of

        links = [{"url": u, "host": h, "context": ""} for u, h in (("https://shop.co.za/a", "shop.co.za"), ("https://click.shop.co.za/b", "click.shop.co.za"), ("https://evil.co.za/c", "evil.co.za"), ("https://shop.co.za.evil.example/d", "shop.co.za.evil.example"), ("https://t.sendgrid.net/e", "t.sendgrid.net"))]
        self.assertEqual([l["host"] for l in own_links(links, "Shop <news@mail.shop.co.za>")], ["shop.co.za", "click.shop.co.za"])
        self.assertEqual(own_links(links, "news@shop.co.za", suspicious="phishing"), [])
        self.assertEqual(own_links(links, ""), [])
        self.assertEqual((site_of("a.b.example.com"), site_of("x.co.uk"), site_of("localhost"), sender_site("no address")), ("example.com", "x.co.uk", "", ""))

    def test_text_for_the_model_has_no_addresses(self):
        body = readable_text(EMAIL)
        self.assertNotIn("http", body)
        self.assertIn("Up to 40% off everything", body)


class Answers(unittest.TestCase):
    links = extract_links(EMAIL)

    def test_a_good_answer_is_kept_with_real_addresses_for_the_chosen_links(self):
        got = check_answer(EMAIL, self.links, {"summary": "A winter sale starts on Friday 30 October.", "points": ["Up to 40% off everything", "Prices from R499"], "links": [{"label": "View the Sale", "id": 1}]})
        self.assertEqual(got, {"summary": "A winter sale starts on Friday 30 October.", "points": ["Up to 40% off everything", "Prices from R499"], "links": [{"label": "View the Sale", "url": "https://shop.example.com/sale?utm=abc", "host": "shop.example.com"}]})

    def test_a_point_with_a_figure_the_email_lacks_is_dropped(self):
        got = check_answer(EMAIL, self.links, {"summary": "A sale.", "points": ["Prices from R399", "Up to 40% off"], "links": []})
        self.assertEqual(got["points"], ["Up to 40% off"])

    def test_a_summary_with_an_invented_figure_makes_the_answer_unusable(self):
        self.assertIsNone(check_answer(EMAIL, self.links, {"summary": "A 70% off sale.", "points": [], "links": []}))
        self.assertIsNone(check_answer(EMAIL, self.links, {"summary": "", "points": [], "links": []}))
        self.assertIsNone(check_answer(EMAIL, self.links, "not json"))

    def test_links_must_be_numbers_from_the_list_and_are_used_once(self):
        got = check_answer(EMAIL, self.links, {"summary": "A sale.", "points": [], "links": [{"label": "A", "id": 2}, {"label": "B", "id": 2}, {"label": "C", "id": 9}, {"label": "D", "id": True}, {"label": "", "id": 1}, {"label": "E", "id": "1"}]})
        self.assertEqual(got["links"], [{"label": "A", "url": "https://shop.example.com/orders/12345", "host": "shop.example.com"}])

    def test_output_is_plain_short_and_has_no_dashes(self):
        long = "Sale " * 100
        got = check_answer("Open 9 to 17 daily.", [], {"summary": "Open 9–17 daily — all week", "points": [long, "A", "A", "B", "C", "D", "E"], "links": []})
        self.assertEqual(got["summary"], "Open 9 to 17 daily, all week")
        self.assertEqual(len(got["points"]), 5)
        self.assertNotIn("—", json.dumps(got, ensure_ascii=False))
        self.assertLessEqual(max(len(p) for p in got["points"]), 120)

    def test_figures_compare_as_numbers_not_digit_runs(self):
        self.assertTrue(grounded("R1,299.50", "Now only R1 299,50 per month"))
        self.assertTrue(grounded("R1,299.50", "Now only R1299.5"))
        self.assertFalse(grounded("R1,399", "Now only R1299"))
        self.assertTrue(grounded("no numbers here", ""))

    def test_a_short_figure_is_not_grounded_by_digits_inside_other_numbers(self):
        # "5" and "20" used to pass because the email's digits run together contained them
        email = "Save 15% until 2026-11-30. Order 1250 today."
        self.assertFalse(grounded("5% off", email))
        self.assertFalse(grounded("Ends on the 20th", email))
        self.assertTrue(grounded("15% off until 30 November", email))
        self.assertTrue(grounded("Order 1,250", email))

    def test_html_only_mail_gets_words_and_link_addresses(self):
        from ai.bulk_read_text import html_text

        text = html_text('<p>Big <b>sale</b> 40% off</p><a href="https://shop.example/sale?a=1&amp;b=2">View the sale</a>')
        self.assertIn("40% off", text)
        self.assertEqual([l["url"] for l in extract_links(text)], ["https://shop.example/sale?a=1&b=2"])

    def test_plain_strips_dashes(self):
        self.assertEqual(plain("a — b", 40), "a, b")

    def test_system_prompt_has_no_dashes_and_marks_mail_as_untrusted(self):
        self.assertNotIn("—", SYSTEM)
        self.assertNotIn("–", SYSTEM)
        self.assertIn("never instructions", SYSTEM)

    def test_prompt_numbers_the_links_inside_a_fence(self):
        p = prompt("Shop <s@x.com>", "Winter Sale", "Body", self.links, "UNTRUSTED-x")
        self.assertTrue(p.startswith("<<<UNTRUSTED-x\n") and p.endswith("UNTRUSTED-x>>>"))
        self.assertIn("1. Shop the sale [shop.example.com]", p)


class FakeDb:
    def __init__(self, message: dict[str, Any] | None, requests=None, claim=True):
        self.message = message
        self.requests = requests if requests is not None else [{"message_id": "m1", "user_id": "u"}]
        self.claim = claim
        self.updates: list[tuple[str, dict, dict]] = []
        self.deleted: list[tuple[str, dict]] = []

    def select(self, table, params):
        return self.requests if table == "bulk_reads" else []

    def first(self, table, params):
        return self.message

    def update(self, table, filters, patch, minimal=False):
        self.updates.append((table, filters, patch))
        return [{"message_id": "m1"}] if table == "bulk_reads" and "claimed_at" in patch and self.claim else []

    def delete(self, table, filters):
        self.deleted.append((table, filters))


class FakeGemini:
    def __init__(self, answer=None, error: GeminiError | None = None):
        self.answer, self.error, self.calls = answer, error, []

    def json(self, model, system, prompt_text, schema, usage, **kw):
        self.calls.append((prompt_text, usage, kw))
        if self.error:
            raise self.error
        return self.answer


def message(**kw):
    return {"id": "m1", "user_id": "u", "account_id": "a", "thread_id": "t", "subject": "Winter Sale", "sender_address": "shop@example.com", "is_bulk": True,
            "body_text": EMAIL, "body_html": None, "body_shrunk_at": None, "message_ai": {"message_id": "m1"}, **kw}


GOOD = {"summary": "A winter sale starts on Friday 30 October.", "points": ["Up to 40% off everything"], "links": [{"label": "View the Sale", "id": 1}]}


class Worker(unittest.TestCase):
    def run_with(self, db, gemini):
        return BulkRead(db, gemini, "fast", __import__("ai.vault", fromlist=["Vault"]).Vault(db)).run_once()

    def errors(self, db):
        return [p["error"] for t, f, p in db.updates if t == "bulk_reads" and "error" in p]

    def test_a_request_is_answered_stored_and_cleared(self):
        db, gemini = FakeDb(message()), FakeGemini(GOOD)
        self.assertEqual(self.run_with(db, gemini), 1)
        [(table, filters, patch)] = [u for u in db.updates if u[0] == "message_ai"]
        self.assertEqual(filters, {"message_id": "eq.m1"})
        self.assertEqual(json.loads(patch["bulk_read"])["links"], [{"label": "View the Sale", "url": "https://shop.example.com/sale?utm=abc", "host": "shop.example.com"}])
        self.assertEqual(db.deleted, [("bulk_reads", {"message_id": "eq.m1"})])
        prompt_text, usage, kw = gemini.calls[0]
        self.assertEqual((usage.feature, usage.user_id, kw["thinking"]), ("bulk_read", "u", "minimal"))
        self.assertNotIn("http", prompt_text.split("Email:")[1])  # addresses go by number, not in the text

    def test_suspicious_mail_and_links_off_the_senders_site_get_no_buttons(self):
        db, gemini = FakeDb(message(message_ai={"message_id": "m1", "suspicious": "phishing"})), FakeGemini(GOOD)
        self.run_with(db, gemini)
        [(_, _, patch)] = [u for u in db.updates if u[0] == "message_ai"]
        self.assertEqual(json.loads(patch["bulk_read"])["links"], [])
        self.assertIn("Links you may use:\n(none)", gemini.calls[0][0])
        db, gemini = FakeDb(message(sender_address="Shop <shop@examp1e-mail.com>")), FakeGemini(GOOD)
        self.run_with(db, gemini)
        [(_, _, patch)] = [u for u in db.updates if u[0] == "message_ai"]
        self.assertEqual(json.loads(patch["bulk_read"])["links"], [], "a lookalike sender cannot offer shop.example.com, nor its own redirect")

    def test_a_request_someone_else_claimed_is_left_alone(self):
        db, gemini = FakeDb(message(), claim=False), FakeGemini(GOOD)
        self.assertEqual(self.run_with(db, gemini), 0)
        self.assertEqual(gemini.calls, [])

    def test_old_shortened_personal_and_unsorted_mail_is_not_read(self):
        for kw, key in (({"body_shrunk_at": "2026-09-01T00:00:00Z"}, "shrunk"), ({"is_bulk": False}, "not_bulk"), ({"message_ai": None}, "not_sorted")):
            db, gemini = FakeDb(message(**kw)), FakeGemini(GOOD)
            self.run_with(db, gemini)
            self.assertEqual(self.errors(db), [UNREADABLE[key]])
            self.assertEqual(gemini.calls, [])
            self.assertEqual(db.deleted, [])

    def test_an_email_with_no_text_is_not_sent_to_the_model(self):
        db, gemini = FakeDb(message(body_text="   ")), FakeGemini(GOOD)
        self.run_with(db, gemini)
        self.assertEqual(self.errors(db), [UNREADABLE["empty"]])
        self.assertEqual(gemini.calls, [])

    def test_a_spent_share_and_other_failures_say_so_and_keep_the_request(self):
        db = FakeDb(message())
        self.run_with(db, FakeGemini(error=GeminiError(None, "budget_paused")))
        self.assertEqual(self.errors(db), [PAUSED])
        db = FakeDb(message())
        self.run_with(db, FakeGemini(error=GeminiError(500, "server error")))
        self.assertEqual(self.errors(db), [FAILED])
        self.assertEqual(db.deleted, [])

    def test_an_answer_that_fails_the_checks_is_not_stored(self):
        db = FakeDb(message())
        self.run_with(db, FakeGemini({"summary": "A 70% off sale.", "points": [], "links": []}))
        self.assertEqual(self.errors(db), [UNREADABLE["nothing"]])
        self.assertFalse([u for u in db.updates if u[0] == "message_ai"])


if __name__ == "__main__":
    unittest.main()


class Skips(Worker):
    def test_a_message_that_already_has_a_result_is_not_paid_for_again(self):
        for ai in ({"message_id": "m1", "bulk_read": "sealed"}, [{"message_id": "m1", "bulk_read": "sealed"}]):
            db, gemini = FakeDb(message(message_ai=ai)), FakeGemini(GOOD)
            self.run_with(db, gemini)
            self.assertEqual(gemini.calls, [])
            self.assertEqual(db.deleted, [("bulk_reads", {"message_id": "eq.m1"})])

    def test_an_html_only_email_is_read_with_its_links(self):
        html = '<p>Winter sale starts on Friday 30 October. Up to 40% off everything, with prices from R499.</p><a href="https://shop.example.com/sale?utm=abc">Shop the sale</a>'
        db, gemini = FakeDb(message(body_text=None, body_html=html)), FakeGemini(GOOD)
        self.run_with(db, gemini)
        [(prompt_text, _, _)] = gemini.calls
        self.assertIn("Shop the sale [shop.example.com]", prompt_text)
        self.assertEqual(self.errors(db), [])
        [(_, _, patch)] = [u for u in db.updates if u[0] == "message_ai"]
        self.assertEqual(json.loads(patch["bulk_read"])["links"][0]["url"], "https://shop.example.com/sale?utm=abc")
