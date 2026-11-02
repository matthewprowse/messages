"""Structured counters for the AI worker: sends do not happen here, but AI calls, jobs and failures do. Kept in memory,
written to the log as one JSON line a minute (the change since the last line) and served in Prometheus text form on the
health port. Names and label values are fixed words and codes, never message text, names or addresses: a label value
that does not look like a code is stored as "other". Mirrors apps/worker/src/ops/metrics.ts."""

from __future__ import annotations

import re
import threading

from .. import log

FLUSH_EVERY_S = 60
_LABEL = re.compile(r"^[A-Za-z0-9_.:-]{1,40}$")

_lock = threading.Lock()
_totals: dict[str, int] = {}
_since_flush: dict[str, int] = {}


def safe_label(value: object) -> str:
    """Label values are codes and outcomes. Anything else (free text, an address) must not become a metric key."""
    return value if isinstance(value, str) and _LABEL.match(value) else "other"


def series_key(name: str, labels: dict[str, str] | None = None) -> str:
    pairs = ",".join(f"{k}={safe_label(v)}" for k, v in sorted((labels or {}).items()))
    return f"{name}{{{pairs}}}" if pairs else name


def count(name: str, labels: dict[str, str] | None = None, by: int = 1) -> None:
    key = series_key(name, labels)
    with _lock:
        _totals[key] = _totals.get(key, 0) + by
        _since_flush[key] = _since_flush.get(key, 0) + by


def count_ai_call(feature: str, outcome: str) -> None:
    count("ai_calls", {"feature": feature, "outcome": outcome})


def count_job(job: str) -> None:
    count("jobs", {"job": job})


def count_failure(code: object, where: str) -> None:
    count("failures", {"code": safe_label(code), "where": where})


def snapshot() -> dict[str, int]:
    with _lock:
        return dict(_totals)


def flush() -> None:
    """Writes the counters that moved since the last flush as one log line. Nothing moved, nothing written."""
    with _lock:
        moved = dict(_since_flush)
        _since_flush.clear()
    if moved:
        log.info("metrics", window_s=FLUSH_EVERY_S, **moved)


def render_prometheus() -> str:
    lines = []
    for key, value in sorted(snapshot().items()):
        if "{" not in key:
            lines.append(f"konva_ai_{key} {value}")
            continue
        name, rest = key.split("{", 1)
        labels = ",".join(f'{k}="{v}"' for k, v in (p.split("=", 1) for p in rest[:-1].split(",")))
        lines.append(f"konva_ai_{name}{{{labels}}} {value}")
    return "\n".join(lines) + ("\n" if lines else "")


def start_flush(stop: threading.Event, every_s: float = FLUSH_EVERY_S) -> threading.Thread:
    def loop() -> None:
        while not stop.wait(every_s):
            flush()

    thread = threading.Thread(target=loop, name="metrics", daemon=True)
    thread.start()
    return thread


def reset() -> None:
    """For tests."""
    with _lock:
        _totals.clear()
        _since_flush.clear()
