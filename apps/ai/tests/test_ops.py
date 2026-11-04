"""Tests for ai/ops: readiness, the health responses, the content-free error report and tracker envelope, and the counters."""

import io
import json
import contextlib
import unittest

from ai.ops import errors, metrics
from ai.ops.health import Health, health_host, health_port, readiness


class Boom(Exception):
    code = "E_BOOM"


def raise_with_secret() -> None:
    secret_address = "anna@example.com"  # a local variable must never reach a report
    raise Boom(f"could not reach {secret_address}: hello there")


def caught() -> BaseException:
    try:
        raise_with_secret()
    except Boom as err:
        return err
    raise AssertionError("unreachable")


class HealthTests(unittest.TestCase):
    def test_readiness_needs_a_tick_the_lease_and_a_recent_loop(self) -> None:
        self.assertTrue(readiness(100, 0, True, 90)["ready"])
        self.assertEqual(readiness(100, 0, True, None)["reasons"], ["no_tick_yet"])
        self.assertEqual(readiness(100, 0, False, 90)["reasons"], ["lease_not_held"])
        self.assertEqual(readiness(1000, 0, True, 100)["reasons"], ["tick_stale"])

    def test_responses_follow_the_clock_and_the_lease(self) -> None:
        now = [0.0]
        h = Health(clock=lambda: now[0])
        self.assertEqual(h.respond("/healthz")[0], 200)
        self.assertEqual(h.respond("/readyz")[0], 503)
        now[0] = 5
        h.tick()
        self.assertEqual(h.respond("/readyz")[0], 200)
        h.set_lease_held(False)
        status, _, body = h.respond("/readyz")
        self.assertEqual(status, 503)
        self.assertEqual(json.loads(body)["reasons"], ["lease_not_held"])
        h.set_lease_held(True)
        now[0] = 500
        self.assertEqual(h.respond("/readyz")[0], 503)
        self.assertEqual(h.respond("/nope")[0], 404)

    def test_the_port_is_off_unless_it_is_a_real_port(self) -> None:
        for raw in (None, "", "off", "abc", "0", "70000"):
            self.assertIsNone(health_port(raw))
        self.assertEqual(health_port("8080"), 8080)

    def test_the_endpoint_listens_on_loopback_unless_health_host_says_otherwise(self):
        self.assertEqual(health_host(None), "127.0.0.1")
        self.assertEqual(health_host("  "), "127.0.0.1")
        self.assertEqual(health_host("0.0.0.0"), "0.0.0.0")


class ErrorTests(unittest.TestCase):
    def setUp(self) -> None:
        metrics.reset()
        errors.set_sink(None)
        errors._last_forward.clear()

    def tearDown(self) -> None:
        errors.set_sink(None)

    def test_a_report_has_the_code_class_and_frames_but_not_the_message_or_locals(self) -> None:
        r = errors.describe(caught(), "triage_loop")
        self.assertEqual((r["code"], r["cls"], r["where"]), ("E_BOOM", "Boom", "triage_loop"))
        self.assertEqual(errors.describe(caught(), "triage loop")["where"], "other")  # free text is not a place
        self.assertEqual(r["frames"][-1]["fn"], "raise_with_secret")
        self.assertNotIn("anna", json.dumps(r))
        self.assertNotIn("hello", json.dumps(r))

    def test_free_text_never_becomes_a_label(self) -> None:
        self.assertEqual(metrics.safe_label("anna@example.com"), "other")
        self.assertEqual(metrics.safe_label(None), "other")
        self.assertEqual(metrics.safe_label("ok_1"), "ok_1")

    def test_paths_lose_the_home_directory(self) -> None:
        self.assertEqual(errors.trim_path("/Users/someone/dev/Messages/apps/ai/ai/triage.py"), "ai/triage.py")
        self.assertEqual(errors.trim_path("/usr/lib/python3/site-packages/x/y.py"), "site-packages/x/y.py")
        self.assertEqual(errors.trim_path("/home/u/script.py"), "script.py")

    def test_reporting_counts_logs_and_forwards_once_a_minute_per_place_and_code(self) -> None:
        seen: list[dict] = []

        class Sink:
            def capture(self, report: dict) -> None:
                seen.append(report)

        errors.set_sink(Sink())
        err = caught()
        with contextlib.redirect_stderr(io.StringIO()) as out:
            errors.report(err, "loop", now=1000)
            errors.report(err, "loop", now=1030)
            errors.report(err, "loop", now=1070)
            errors.report(err, "other", now=1070)
        self.assertEqual(len(seen), 3)
        self.assertEqual(metrics.snapshot()["failures{code=E_BOOM,where=loop}"], 3)
        line = json.loads(out.getvalue().splitlines()[0])
        self.assertEqual(line["code"], "E_BOOM")
        self.assertNotIn("anna", out.getvalue())

    def test_a_failing_sink_does_not_break_the_caller(self) -> None:
        class Bad:
            def capture(self, report: dict) -> None:
                raise RuntimeError("tracker bug")

        errors.set_sink(Bad())
        with contextlib.redirect_stderr(io.StringIO()):
            errors.report(caught(), "loop", now=5000)

    def test_a_dsn_becomes_an_envelope_url_and_key(self) -> None:
        self.assertEqual(errors.parse_dsn("https://abc123@o1.ingest.example.io/456"), ("https://o1.ingest.example.io/api/456/envelope/", "abc123"))
        for bad in ("https://o1.ingest.example.io/456", "not a url", "ftp://k@h/1", ""):
            self.assertIsNone(errors.parse_dsn(bad))
        with self.assertRaises(ValueError):
            errors.SentrySink("garbage", "ai")

    def test_the_envelope_holds_code_place_and_frames_only(self) -> None:
        r = {"code": "E1", "cls": "Boom", "where": "loop", "frames": [{"fn": "a", "file": "ai/a.py", "line": 3}]}
        header, kind, event = (json.loads(x) for x in errors.envelope_for(r, "ai", "https://k@h/1", now=1_700_000_000, event_id="f" * 32).split("\n"))
        self.assertEqual(header["event_id"], "f" * 32)
        self.assertEqual(kind, {"type": "event"})
        self.assertEqual(event["exception"]["values"][0]["value"], "E1")
        self.assertEqual(sorted(event), ["event_id", "exception", "level", "logger", "platform", "tags", "timestamp"])

    def test_the_sink_posts_with_the_public_key(self) -> None:
        sent: list[tuple] = []
        sink = errors.SentrySink("https://abc@h.example/7", "ai", post=lambda url, headers, body: sent.append((url, headers, body)))
        sink.capture({"code": "X", "cls": "Boom", "where": "w", "frames": []})
        for t in __import__("threading").enumerate():
            if t.name == "error-forward":
                t.join(2)
        self.assertEqual(sent[0][0], "https://h.example/api/7/envelope/")
        self.assertIn("sentry_key=abc", sent[0][1]["x-sentry-auth"])


class MetricTests(unittest.TestCase):
    def setUp(self) -> None:
        metrics.reset()

    def test_series_are_keyed_by_sorted_labels(self) -> None:
        self.assertEqual(metrics.series_key("ai_calls", {"outcome": "ok", "feature": "draft"}), "ai_calls{feature=draft,outcome=ok}")

    def test_flush_writes_the_change_once_and_prometheus_renders_totals(self) -> None:
        metrics.count_ai_call("draft", "ok")
        metrics.count_ai_call("draft", "ok")
        metrics.count_job("embed")
        with contextlib.redirect_stdout(io.StringIO()) as out:
            metrics.flush()
            metrics.flush()  # nothing moved: nothing written
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        line = json.loads(lines[0])
        self.assertEqual(line["ai_calls{feature=draft,outcome=ok}"], 2)
        text = metrics.render_prometheus()
        self.assertIn('konva_ai_ai_calls{feature="draft",outcome="ok"} 2', text)
        self.assertIn('konva_ai_jobs{job="embed"} 1', text)


if __name__ == "__main__":
    unittest.main()
