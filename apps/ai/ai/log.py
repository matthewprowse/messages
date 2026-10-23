"""JSON log lines with IDs, counts and error codes only, never message content or addresses."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone


def _write(level: str, msg: str, **fields: object) -> None:
    line = {"t": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), "level": level, "msg": msg, **fields}
    print(json.dumps(line), file=sys.stderr if level == "error" else sys.stdout, flush=True)


def info(msg: str, **fields: object) -> None:
    _write("info", msg, **fields)


def warn(msg: str, **fields: object) -> None:
    _write("warn", msg, **fields)


def error(msg: str, **fields: object) -> None:
    _write("error", msg, **fields)
