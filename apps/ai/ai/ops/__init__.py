"""Operations for the AI worker: health endpoint, content-free error reporting and counters. `start()` is what the entry
point calls; see docs/RUNBOOK.md for what the alerts mean."""

from __future__ import annotations

import os
import threading

from .. import log
from . import errors, metrics
from .errors import report
from .health import Health, health_port, serve

__all__ = ["Health", "report", "start", "metrics"]


def start(stop: threading.Event) -> Health:
    """Error reporting, the metrics log line and (when HEALTH_PORT is set) the health endpoint. The returned Health is
    ticked by the draft loop and told when the lease is lost."""
    errors.init("ai")
    metrics.start_flush(stop)
    health = Health()
    port = health_port(os.environ.get("HEALTH_PORT"))
    if port:
        try:
            serve(health, port)
            log.info("health endpoint listening", port=port)
        except OSError as err:
            report(err, "health_server")
    return health
