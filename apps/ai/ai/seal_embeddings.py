"""One-off backfill: sealed the plaintext vectors that were in message_embeddings.embedding into
message_embeddings.embedding_data, so the plaintext column could be dropped
(20261102800100_drop_plaintext_embeddings, applied only after this had run).

FINISHED on 28 October 2026: all 2,486 vectors were sealed and checked against their plaintext, then the column was dropped.
It can no longer run against the database, which has no `embedding` column. It stays for its tests, which show how a
vector is read, sealed and written.

    python3 -m ai.seal_embeddings           dry run: counts what would be sealed, writes nothing
    python3 -m ai.seal_embeddings --apply   seals and writes

It reads each old vector, seals it with the owner's data key (similar.seal_vector) and writes the new
column. It never calls Gemini and never changes or deletes the old column. A user with no key yet is
skipped and counted, and the run can be repeated: it only touches rows with a vector and no sealed one.
Values are never printed."""

from __future__ import annotations

import json
import sys
from typing import Any

from . import config, log
from .similar import seal_vector
from .supabase import Supabase
from .vault import Vault

BATCH = 200


def parse_vector(text: Any) -> list[float] | None:
    """pgvector's text form ("[0.1,0.2]") is a JSON array. None when it is not a list of numbers."""
    try:
        values = json.loads(text) if isinstance(text, str) else text
        return [float(v) for v in values] if isinstance(values, list) and values else None
    except (ValueError, TypeError):
        return None


def run(db: Any, vault: Vault, *, apply: bool, batch: int = BATCH) -> dict[str, int]:
    """Walks the rows with a readable vector and no sealed one, by message id. Returns counts."""
    counts = {"found": 0, "sealed": 0, "no_key": 0, "bad": 0, "failed": 0}
    last = None
    while True:
        params = {
            "select": "message_id,user_id,sent_at,embedding",
            "embedding": "not.is.null",
            "embedding_data": "is.null",
            "order": "message_id",
            "limit": str(batch),
        }
        if last:
            params["message_id"] = f"gt.{last}"
        rows = db.select("message_embeddings", params)
        if not rows:
            return counts
        last = rows[-1]["message_id"]
        out = []
        for r in rows:
            counts["found"] += 1
            keys = vault.keys_for(r["user_id"])
            if keys is None:
                counts["no_key"] += 1
                continue
            vector = parse_vector(r["embedding"])
            if vector is None:
                counts["bad"] += 1
                continue
            out.append({"message_id": r["message_id"], "user_id": r["user_id"], "sent_at": r["sent_at"], "embedding_data": seal_vector(keys, vector)})
        if apply and out:
            try:
                db.upsert("message_embeddings", out, on_conflict="message_id")
                counts["sealed"] += len(out)
            except Exception as err:
                counts["failed"] += len(out)
                log.warn("seal batch failed", rows=len(out), code=log.code_of(err))
        elif out:
            counts["sealed"] += len(out)  # would be sealed


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    apply = "--apply" in args
    cfg = config.load()
    db = Supabase(cfg.supabase_url, cfg.service_role_key)
    vault = Vault(db, cfg.key_wrapping_key, cfg.encrypt_content)
    counts = run(db, vault, apply=apply)
    verb = "sealed" if apply else "would seal"
    print(f"{'APPLIED' if apply else 'DRY RUN'}: found {counts['found']}, {verb} {counts['sealed']}, no key {counts['no_key']}, unreadable {counts['bad']}, failed {counts['failed']}")
    if not apply:
        print("Nothing was written. Run again with --apply to seal.")
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
