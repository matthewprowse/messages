"""Runs the AI worker: drafts are checked every second and a half, and every half second while drafts
are being asked for, so they feel instant; several are written at once. Triage and learning run
alongside in their own thread. Stop with Ctrl+C.

Learning keeps layered memory fresh: your voice (re-learned every 10 sent emails), notes on each
person and company, rules from the tones, instructions and guided drafting choices you pick, and
embeddings of every email for finding how you answered similar ones. The spoken daily brief is written
in a thread of its own."""

from __future__ import annotations

import signal
import threading
import time

from . import config, log
from .brief import POLL_S as BRIEF_POLL_S, Brief
from .drafts import Drafts
from .embed import Embeddings
from .gemini import Gemini
from .learn import Learn
from .people import People
from .signals import Signals
from .supabase import Supabase, missing_relation
from .triage import Triage
from .vault import Vault
from .voice import Voice

TRIAGE_IDLE_S = 15
LEARN_EVERY_S = 60
VOICE_EVERY_S = 300  # only checks who is due: a user is relearned once they have sent 10 more emails
SIGNALS_EVERY_S = 3600  # each user is rechecked hourly at most (signals.RECHECK_S), so reading more often only wastes the read
PEOPLE_EVERY_S = 600  # a user with no new mail since the last look is skipped (people.RESCAN_S)
EMBED_EVERY_S = 15  # a batch each time, so the backfill is gradual


def main() -> None:
    cfg = config.load()
    db = Supabase(cfg.supabase_url, cfg.service_role_key)
    vault = Vault(db, cfg.key_wrapping_key, cfg.encrypt_content)  # one key cache shared by every job
    gemini = Gemini(cfg.gemini_api_key, db)
    embeddings = Embeddings(db, gemini, cfg.embed_model, vault)
    drafts = Drafts(db, gemini, cfg.model, embeddings, vault)
    triage = Triage(db, gemini, cfg.fast_model, vault)
    # (name, every seconds, job): each runs when due, one after another, between triage batches.
    jobs = [
        ("learn", LEARN_EVERY_S, Learn(db, gemini, cfg.model, vault).run_once),
        ("voice", VOICE_EVERY_S, Voice(db, gemini, cfg.model, vault).run_once),
        ("signals", SIGNALS_EVERY_S, Signals(db, gemini, cfg.model, vault).run_once),
        ("people", PEOPLE_EVERY_S, People(db, gemini, cfg.model, cfg.fast_model, vault).run_once),
        ("embed", EMBED_EVERY_S, embeddings.run_once),
    ]
    stop = threading.Event()

    def background() -> None:
        last = {name: 0.0 for name, _, _ in jobs}
        while not stop.is_set():
            busy = 0
            try:
                busy = triage.run_once()
            except Exception as err:
                log.error("triage loop failed", code=getattr(err, "code", None) or type(err).__name__)
            for name, every, job in jobs:
                if stop.is_set() or time.monotonic() - last[name] <= every:
                    continue
                last[name] = time.monotonic()
                try:
                    job()
                except Exception as err:
                    log.error(f"{name} loop failed", code=getattr(err, "code", None) or type(err).__name__)
            stop.wait(1 if busy else min(TRIAGE_IDLE_S, EMBED_EVERY_S))  # work through a backlog quickly, then idle

    brief = Brief(db, gemini, cfg.model, cfg.tts_model, cfg.tts_voice, vault)

    def briefs() -> None:
        """Writing and speaking a brief takes up to a minute, so it has a thread of its own."""
        while not stop.is_set():
            try:
                brief.run_once()
            except Exception as err:
                if missing_relation(err):  # the briefs migration is not applied yet
                    stop.wait(600)
                    continue
                log.error("brief loop failed", code=getattr(err, "code", None) or type(err).__name__)
            stop.wait(BRIEF_POLL_S)

    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    threading.Thread(target=background, name="triage", daemon=True).start()
    threading.Thread(target=briefs, name="brief", daemon=True).start()
    log.info(
        "ai worker starting",
        model=cfg.model,
        fast_model=cfg.fast_model,
        embed_model=cfg.embed_model,
        tts_model=cfg.tts_model,
        encrypt_content=cfg.encrypt_content,
        key_wrapping_key=bool(cfg.key_wrapping_key),  # whether it is set, never the key
    )
    try:
        while not stop.is_set():
            try:
                drafts.run_once()
            except Exception as err:
                log.error("draft loop failed", code=getattr(err, "code", None) or type(err).__name__)
            stop.wait(drafts.poll_wait())
    except KeyboardInterrupt:
        stop.set()
    log.info("ai worker stopping")


if __name__ == "__main__":
    main()
