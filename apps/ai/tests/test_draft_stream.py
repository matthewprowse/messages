"""Tests for drafts shown while they are written: the body read out of JSON still being written, the throttled writes
to the pending row, and the streamed Gemini call (same answer as a plain one, and a plain one when the stream fails)."""

import json
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

from ai.drafts_stream import EVERY_S, Shown, partial_string
from ai.gemini import Gemini, UsageContext
from ai.http import Refused, Response
from ai.vault import Vault
from tests.test_vault import MASTER_B64


class Partial(unittest.TestCase):
    def test_the_body_so_far(self):
        self.assertIsNone(partial_string('{"bo'))
        self.assertIsNone(partial_string('{"body":'))
        self.assertEqual(partial_string('{"body": "'), "")
        self.assertEqual(partial_string('{"body":"Hi Sam,\\nThanks for'), "Hi Sam,\nThanks for")
        self.assertEqual(partial_string('{"body":"Say \\"yes\\" and'), 'Say "yes" and')
        self.assertEqual(partial_string('{"body":"done", "action": null}'), "done")

    def test_an_escape_cut_off_waits_for_the_rest(self):
        self.assertEqual(partial_string('{"body":"line\\'), "line")
        self.assertEqual(partial_string('{"body":"caf\\u00'), "caf")
        self.assertEqual(partial_string('{"body":"caf\\u00e9'), "café")
        self.assertEqual(partial_string('{"body":"smile \\ud83d'), "smile ")

    def test_the_body_after_another_field(self):
        self.assertEqual(partial_string('{"said":"move it","body":"Sure, Fri'), "Sure, Fri")


class Db:
    def __init__(self):
        self.updates: list[tuple[str, dict, dict]] = []

    def update(self, table, filters, patch, minimal=False):
        self.updates.append((table, filters, patch))

    def first(self, *a, **k):
        return None


class Writes(unittest.TestCase):
    def test_the_pending_row_gets_the_body_sealed_throttled_and_only_while_pending(self):
        db = Db()
        vault = Vault(db, MASTER_B64, False)  # plaintext passes through, so what was written can be read here
        d = {"id": "d1", "user_id": "u"}
        pool = ThreadPoolExecutor(max_workers=2)
        shown = Shown(db, vault, d, pool)
        shown('{"body":"Hi')  # too short to show yet
        shown('{"body":"Hi Sam, thanks for the note')
        shown('{"body":"Hi Sam, thanks for the note, Friday')  # within EVERY_S: held
        time.sleep(EVERY_S + 0.05)
        shown('{"body":"Hi Sam, thanks for the note, Friday works — see you')
        pool.shutdown(wait=True)
        bodies = [p["body"] for _, _, p in db.updates]
        self.assertEqual(bodies[0], "Hi Sam, thanks for the note")
        self.assertTrue(bodies[-1].startswith("Hi Sam, thanks for the note, Friday works"))
        self.assertNotIn("—", bodies[-1])  # no em dashes shown, as in the finished draft
        self.assertTrue(all(f["status"] == "eq.pending" and f["id"] == "eq.d1" for _, f, _ in db.updates))
        self.assertTrue(d["_shown"])


def sse(*pieces: dict) -> list[bytes]:
    return [b"data: " + json.dumps(p).encode() + b"\r\n" for p in pieces] + [b"\r\n"]


def piece(text: str, finish: str | None = None, usage: dict | None = None) -> dict:
    out: dict = {"candidates": [{"content": {"parts": [{"text": text}]}, **({"finishReason": finish} if finish else {})}]}
    if usage:
        out["usageMetadata"] = usage
    return out


class Budget:
    def select(self, table, params):
        return []

    def first(self, *a, **k):
        return None

    def rpc(self, function, args):
        return {"features": {"draft": 1.0}, "week_features": {}} if function == "ai_allowance_for" else {}

    def insert(self, *a, **k):
        pass


class Streamed(unittest.TestCase):
    def setUp(self):
        self.gemini = Gemini("k", Budget())
        self.addCleanup(self.gemini.close)

    def ask(self, seen):
        return self.gemini.json("gemini-3.8-flash", "s", "p", {"type": "object"}, UsageContext("u", "draft"), on_text=seen.append)

    def test_the_answer_is_put_back_together_and_shown_as_it_grows(self):
        lines = sse(piece('{"body":"Hi '), piece('Sam"}'), piece("", "STOP", {"promptTokenCount": 10, "candidatesTokenCount": 5}))
        seen: list[str] = []
        with mock.patch("ai.gemini_stream.POOL.stream", return_value=iter(lines)), mock.patch("ai.gemini.POOL.request") as plain:
            self.assertEqual(self.ask(seen), {"body": "Hi Sam"})
        plain.assert_not_called()
        self.assertEqual(seen, ['{"body":"Hi ', '{"body":"Hi Sam"}'])

    def test_a_stream_that_fails_is_sent_again_whole(self):
        def broken(*a, **k):
            yield from sse(piece('{"body":"Hi '))
            raise OSError("reset")

        whole = Response(200, {}, json.dumps({"candidates": [{"content": {"parts": [{"text": '{"body": "Hi Sam"}'}]}}], "usageMetadata": {}}).encode())
        with mock.patch("ai.gemini_stream.POOL.stream", side_effect=broken), mock.patch("ai.gemini.POOL.request", return_value=whole) as plain:
            self.assertEqual(self.ask([]), {"body": "Hi Sam"})
        plain.assert_called_once()

    def test_a_refused_stream_is_sent_again_whole_but_billing_is_not(self):
        whole = Response(200, {}, json.dumps({"candidates": [{"content": {"parts": [{"text": '{"body": "ok"}'}]}}]}).encode())
        refused = Refused(Response(503, {}, b'{"error": {"status": "UNAVAILABLE"}}'))
        with mock.patch("ai.gemini_stream.POOL.stream", side_effect=refused), mock.patch("ai.gemini.POOL.request", return_value=whole):
            self.assertEqual(self.ask([]), {"body": "ok"})
        billing = Refused(Response(403, {}, b'{"error": {"status": "PERMISSION_DENIED", "message": "billing account disabled"}}'))
        with mock.patch("ai.gemini_stream.POOL.stream", side_effect=billing), mock.patch("ai.gemini.POOL.request") as plain:
            with self.assertRaises(Exception):
                self.ask([])
        plain.assert_not_called()


if __name__ == "__main__":
    unittest.main()
