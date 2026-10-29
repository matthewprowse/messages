"""The Gemini billing breaker: what counts as a billing error, trip, probe and recover, no request while
tripped, and billing_paused not counting as a try for voice notes and meetings."""

import unittest
from unittest import mock

from ai import gemini
from ai.billing import Breaker, is_billing_error, is_billing_paused
from ai.gemini import Gemini, GeminiError
from ai.http import Response
from ai.meetings import MAX_TRIES as MEETING_TRIES
from ai.meetings import Meetings
from ai.transcribe import MAX_TRIES, Transcribe


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Classify(unittest.TestCase):
    def test_billing(self):
        self.assertTrue(is_billing_error(402))
        self.assertTrue(is_billing_error(403, "PERMISSION_DENIED"))
        self.assertTrue(is_billing_error(400, "FAILED_PRECONDITION", "Billing is not enabled for this project"))
        self.assertTrue(is_billing_error(429, "RESOURCE_EXHAUSTED", "Your prepayment credits are depleted"))
        self.assertTrue(is_billing_error(429, "RESOURCE_EXHAUSTED", "check your plan and billing details"))
        self.assertTrue(is_billing_error(400, "PERMISSION_DENIED"))

    def test_ordinary_limits_are_not(self):
        self.assertFalse(is_billing_error(429, "RESOURCE_EXHAUSTED", "Quota exceeded for requests per minute. Please retry in 37s"))
        self.assertFalse(is_billing_error(429, "RESOURCE_EXHAUSTED", "exceeded your quota per minute, check plan and billing details"))
        self.assertFalse(is_billing_error(429, "RESOURCE_EXHAUSTED"))
        self.assertFalse(is_billing_error(500, "INTERNAL", "billing"))
        self.assertFalse(is_billing_error(400, "INVALID_ARGUMENT", "bad schema"))
        self.assertFalse(is_billing_error(None, "ConnectionError"))


class BreakerStates(unittest.TestCase):
    def test_trip_probe_recover(self):
        clock = Clock()
        b = Breaker(600, clock)
        self.assertTrue(b.allow())
        self.assertTrue(b.trip())
        self.assertFalse(b.trip())  # already tripped: no second log
        self.assertFalse(b.allow())
        clock.now += 599
        self.assertFalse(b.allow())
        clock.now += 2
        self.assertTrue(b.allow())  # the probe
        self.assertFalse(b.allow())  # only one at a time
        b.trip()  # the probe failed on billing: a new window
        self.assertFalse(b.allow())
        clock.now += 601
        self.assertTrue(b.allow())
        self.assertTrue(b.success())
        self.assertFalse(b.success())
        self.assertTrue(b.allow() and b.allow())

    def test_probe_failing_otherwise_lets_the_next_probe(self):
        clock = Clock()
        b = Breaker(10, clock)
        b.trip()
        clock.now += 11
        self.assertTrue(b.allow())
        b.release()
        self.assertTrue(b.tripped)
        self.assertTrue(b.allow())


def client() -> tuple[Gemini, Clock]:
    g = Gemini("key", mock.Mock())
    clock = Clock()
    g._breaker = Breaker(600, clock)
    return g, clock


def reply(status: int, body: bytes = b"{}") -> Response:
    return Response(status, {}, body)


class GeminiBreaker(unittest.TestCase):
    def test_trips_once_and_stops_requests(self):
        g, clock = client()
        denied = reply(403, b'{"error":{"status":"PERMISSION_DENIED","message":"billing"}}')
        with mock.patch.object(gemini.POOL, "request", return_value=denied) as req, mock.patch.object(gemini.log, "warn") as warn, mock.patch.object(gemini.time, "sleep") as sleep:
            for _ in range(3):
                with self.assertRaises(GeminiError) as cm:
                    g._call("m", {})
                self.assertTrue(is_billing_paused(cm.exception))
            self.assertEqual(req.call_count, 1)
            self.assertEqual(warn.call_count, 1)
            sleep.assert_not_called()
            with self.assertRaises(GeminiError):
                g.batch_submit("m", [("k", {})])
            with self.assertRaises(GeminiError):
                g.upload_file(b"x", "audio/wav")
            self.assertEqual(req.call_count, 1)

    def test_billing_429_is_not_retried(self):
        g, _ = client()
        body = b'{"error":{"status":"RESOURCE_EXHAUSTED","message":"Your prepayment credits are depleted"}}'
        with mock.patch.object(gemini.POOL, "request", return_value=reply(429, body)) as req, mock.patch.object(gemini.time, "sleep"):
            with self.assertRaises(GeminiError):
                g._call("m", {})
        self.assertEqual(req.call_count, 1)

    def test_ordinary_429_is_still_retried(self):
        g, _ = client()
        body = b'{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded for requests per minute"}}'
        with mock.patch.object(gemini.POOL, "request", return_value=reply(429, body)) as req, mock.patch.object(gemini.time, "sleep"):
            with self.assertRaises(GeminiError):
                g._call("m", {}, attempts=3)
        self.assertEqual(req.call_count, 3)
        self.assertFalse(g._breaker.tripped)

    def test_probe_recovers_with_one_info(self):
        g, clock = client()
        g._breaker.trip()
        clock.now += 601
        with mock.patch.object(gemini.POOL, "request", return_value=reply(200, b'{"ok":1}')), mock.patch.object(gemini.log, "info") as info:
            self.assertEqual(g._call("m", {}), {"ok": 1})
            g._call("m", {})
        self.assertFalse(g._breaker.tripped)
        self.assertEqual(info.call_count, 1)


class NotATry(unittest.TestCase):
    def test_transcribe(self):
        db = mock.Mock()
        worker = Transcribe(db, mock.Mock(), "m", mock.Mock())
        m = {"id": "m1"}
        for _ in range(MAX_TRIES + 2):
            worker._failed(m, GeminiError(403, "billing_paused"))
        self.assertEqual(worker._tries["m1"][0], 0)
        db.update.assert_not_called()
        worker._failed(m, GeminiError(500, "boom"))
        self.assertEqual(worker._tries["m1"][0], 1)

    def test_meetings(self):
        db = mock.Mock()
        worker = Meetings(db, mock.Mock(), "model", mock.Mock())
        m = {"id": "x"}
        for _ in range(MEETING_TRIES + 2):
            worker._failed(m, "transcribing", "why", GeminiError(None, "billing_paused"))
        self.assertEqual(worker._tries["x"][0], 0)
        db.update.assert_not_called()


if __name__ == "__main__":
    unittest.main()
