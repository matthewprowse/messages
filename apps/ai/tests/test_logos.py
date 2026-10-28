"""Tests for ai.logos: the judging prompt, reading the model's verdict (only a passing pick on the sheet is kept), the
order of search URLs and the price of search queries."""

import unittest
from datetime import date

from ai.logos import LAST_LOOK, candidates_text, judge_prompt, read_verdict, search_urls
from ai.pricing import SEARCH_QUERY_USD, cost_usd

CANDIDATES = [
    {"n": 1, "source": "app_store", "url": "https://a.example/1.jpg", "note": 'App Store app "Checkers Sixty60" by Shoprite Checkers'},
    {"n": 2, "source": "site", "url": "https://checkers.co.za/icon.png"},
    {"n": 3, "source": "simple_icons", "url": "https://cdn.example/checkers.svg"},
]


class LogoJudgeTest(unittest.TestCase):
    def test_prompt_names_the_company_and_where_each_candidate_came_from(self):
        prompt = judge_prompt("Checkers", "checkers.co.za", CANDIDATES)
        self.assertIn("Company: Checkers\nDomain: checkers.co.za", prompt)
        self.assertIn('1: App Store app "Checkers Sixty60" by Shoprite Checkers', prompt)
        self.assertIn("2: an icon on the company's website", candidates_text(CANDIDATES))
        self.assertIn("3: Simple Icons (one colour only)", prompt)
        self.assertNotIn("last look", prompt)
        self.assertTrue(judge_prompt("Checkers", "checkers.co.za", CANDIDATES, last_look=True).endswith(LAST_LOOK))

    def test_verdict_keeps_a_pick_that_passes_and_records_the_rest(self):
        answer = {
            "candidates": [
                {"n": 1, "passes": False, "reason": "A sub-brand."},
                {"n": 2, "passes": True, "reason": "The red logo."},
                {"n": 3, "passes": False, "reason": "One colour."},
            ],
            "pick": 2,
            "reason": "The current logo.",
        }
        pick, reason, rejected = read_verdict(answer, CANDIDATES)
        self.assertEqual(pick, 2)
        self.assertEqual(reason, "The current logo.")
        self.assertEqual([(r["n"], r["source"], r["reason"]) for r in rejected], [(1, "app_store", "A sub-brand."), (3, "simple_icons", "One colour.")])

    def test_verdict_drops_a_pick_that_is_not_on_the_sheet_or_that_failed(self):
        self.assertIsNone(read_verdict({"candidates": [], "pick": 7, "reason": ""}, CANDIDATES)[0])
        failed = {"candidates": [{"n": 1, "passes": False, "reason": "Clipped."}], "pick": 1, "reason": ""}
        pick, _, rejected = read_verdict(failed, CANDIDATES)
        self.assertIsNone(pick)
        self.assertEqual(len(rejected), 3)
        self.assertIsNone(read_verdict({"pick": 0}, CANDIDATES)[0])
        self.assertIsNone(read_verdict({"pick": "none"}, CANDIDATES)[0])


class LogoSearchTest(unittest.TestCase):
    def test_image_addresses_first_then_pages_without_rejected_ones(self):
        text = "Here:\n- https://img.example/logo.svg.\n* [x](https://img.example/icon.png)\nhttps://img.example/logo.svg"
        pages = ["https://page.example/a", "https://page.example/b", "https://page.example/c", "https://page.example/d"]
        urls = search_urls(text, pages, ["https://page.example/b"])
        self.assertEqual(urls, ["https://img.example/logo.svg", "https://img.example/icon.png", "https://page.example/a", "https://page.example/c"])
        self.assertEqual(search_urls("No http links here, only http://plain.example/x.png", [], []), [])

    def test_search_queries_are_priced(self):
        self.assertEqual(SEARCH_QUERY_USD, 0.014)
        self.assertAlmostEqual(cost_usd("gemini-3.5-flash-lite", date(2026, 10, 26), 1_000_000, 0, 0), 0.30)


if __name__ == "__main__":
    unittest.main()
