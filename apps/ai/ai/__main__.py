"""Runs the AI worker: drafts are checked every second and a half, and every half second while drafts
are being asked for, so they feel instant; several are written at once. Triage and learning run
alongside in their own thread. Stop with Ctrl+C.

Learning keeps layered memory fresh: your voice (re-learned every 10 sent emails), notes on each
person and company, rules from the tones, instructions and guided drafting choices you pick, and
embeddings of every email for finding how you answered similar ones. The spoken daily brief is written
in a thread of its own, and so are meetings (recordings transcribed, transcripts summarised), as an hour's
recording can take minutes."""

from __future__ import annotations

import signal
import sys
import threading
import time

from . import config, log
from .brief import IDLE_S as BRIEF_IDLE_S, POLL_S as BRIEF_POLL_S, Brief
from .chasers import Chasers
from .drafts import Drafts
from .embed import Embeddings
from .gemini import Gemini
from .learn import Learn
from .logos import Logos
from .meetings import Meetings
from .people import People
from .poll import Backoff
from .signals import Signals
from .supabase import Supabase, missing_relation
from .transcribe import Transcribe
from .triage import Triage
from .vault import Vault
from .voice import Voice

TRIAGE_IDLE_S = 15
LEARN_EVERY_S = 60
VOICE_EVERY_S = 300  # only checks who is due: a user is relearned once they have sent 10 more emails
SIGNALS_EVERY_S = 3600  # each user is rechecked hourly at most (signals.RECHECK_S), so reading more often only wastes the read
PEOPLE_EVERY_S = 600  # a user with no new mail since the last look is skipped (people.RESCAN_S)
EMBED_EVERY_S = 15  # a batch each time, so the backfill is gradual
FOLLOW_UPS_EVERY_S = 900  # your last message in a conversation is read once, a day after you sent it
TRANSCRIBE_EVERY_S = 5  # soon after a voice note is saved, so triage (which waits for it) is not held up
MEETINGS_EVERY_S = 30
LOGOS_EVERY_S = 30  # the sync worker hands over a sheet to judge as soon as it has framed one
# How far an idle job backs off, in seconds: a job that finds nothing waits twice as long, up to this, and goes back
# to its interval above once it finds work. Jobs not listed keep their interval.
IDLE_CEILING_S = {"transcribe": 15, "learn": 300, "embed": 60, "logos": 120, "follow_ups": 3600}
MEETINGS_IDLE_S = 60


def main() -> None:
    if sys.argv[1:2] == ["instagram"]:  # Instagram direct messages, a process of its own (pnpm instagram)
        from .connectors.instagram.run import main as instagram

        instagram()
        return
    if sys.argv[1:2] == ["icloud-reminders"]:  # iCloud Reminders through iCloud.com's web sign-in, a process of its own
        from .connectors.icloud_reminders.run import main as icloud_reminders

        icloud_reminders()
        return
    if sys.argv[1:2] == ["logos"]:  # the logo queue's Gemini steps until none are waiting, for a backfill
        from .logos import main as logos

        logos()
        return
    cfg = config.load()
    db = Supabase(cfg.supabase_url, cfg.service_role_key)
    vault = Vault(db, cfg.key_wrapping_key, cfg.encrypt_content)  # one key cache shared by every job
    gemini = Gemini(cfg.gemini_api_key, db)
    embeddings = Embeddings(db, gemini, cfg.embed_model, vault)
    drafts = Drafts(db, gemini, cfg.model, embeddings, vault, fast_model=cfg.fast_model, predraft_model=cfg.predraft_model)
    triage = Triage(db, gemini, cfg.fast_model, vault)
    # (name, every seconds, job): each runs when due, one after another, between triage batches.
    jobs = [
        ("transcribe", TRANSCRIBE_EVERY_S, Transcribe(db, gemini, cfg.model, vault).run_once),
        ("learn", LEARN_EVERY_S, Learn(db, gemini, cfg.learn_model, vault).run_once),
        ("voice", VOICE_EVERY_S, Voice(db, gemini, cfg.learn_model, vault).run_once),
        ("signals", SIGNALS_EVERY_S, Signals(db, gemini, cfg.learn_model, vault).run_once),
        ("people", PEOPLE_EVERY_S, People(db, gemini, cfg.learn_model, cfg.fast_model, vault).run_once),
        ("embed", EMBED_EVERY_S, embeddings.run_once),
        ("follow_ups", FOLLOW_UPS_EVERY_S, Chasers(db, gemini, cfg.brief_model, vault).run_once),
    ]
    if cfg.company_logos:  # off until the logo system is rolled out (docs/PLAN.md, Company Logos)
        jobs.append(("logos", LOGOS_EVERY_S, Logos(db, gemini, cfg.fast_model).run_once))
    stop = threading.Event()

    def background() -> None:
        last = {name: 0.0 for name, _, _ in jobs}
        waits = {name: Backoff(every, IDLE_CEILING_S.get(name, every)) for name, every, _ in jobs}
        due = {name: every for name, every, _ in jobs}  # seconds to wait since the job last ran
        while not stop.is_set():
            busy = 0
            try:
                busy = triage.run_once()
            except Exception as err:
                log.error("triage loop failed", code=log.code_of(err))
            for name, every, job in jobs:
                if stop.is_set() or time.monotonic() - last[name] <= due[name]:
                    continue
                last[name] = time.monotonic()
                try:
                    found = job()
                    due[name] = waits[name].next(not isinstance(found, int) or found > 0)
                except Exception as err:
                    due[name] = every
                    log.error(f"{name} loop failed", code=log.code_of(err))
            stop.wait(1 if busy else min(TRIAGE_IDLE_S, EMBED_EVERY_S))  # work through a backlog quickly, then idle

    brief = Brief(db, gemini, cfg.brief_model, cfg.tts_model, cfg.tts_voice, vault)

    def briefs() -> None:
        """Writing and speaking a brief takes up to a minute, so it has a thread of its own. Idle, it looks less
        often (up to BRIEF_IDLE_S), and quickly again once a brief is asked for or due."""
        wait = Backoff(BRIEF_POLL_S, BRIEF_IDLE_S)
        while not stop.is_set():
            found = True
            try:
                found = brief.run_once() > 0
            except Exception as err:
                if missing_relation(err):  # the briefs migration is not applied yet
                    stop.wait(600)
                    continue
                log.error("brief loop failed", code=log.code_of(err))
            stop.wait(wait.next(found))

    meetings = Meetings(db, gemini, cfg.model, vault, transcribe_model=cfg.transcribe_model)

    def meeting_steps() -> None:
        """Transcribing a long recording takes minutes, so meetings have a thread of their own too."""
        meeting_wait = Backoff(MEETINGS_EVERY_S, MEETINGS_IDLE_S)
        while not stop.is_set():
            busy = 0
            try:
                busy = meetings.run_once()
                if busy:
                    meeting_wait.reset()
            except Exception as err:
                if missing_relation(err):  # the meetings migration is not applied yet
                    stop.wait(600)
                    continue
                log.error("meetings loop failed", code=log.code_of(err))
            stop.wait(1 if busy else meeting_wait.next(False))

    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    threading.Thread(target=background, name="triage", daemon=True).start()
    threading.Thread(target=briefs, name="brief", daemon=True).start()
    threading.Thread(target=meeting_steps, name="meetings", daemon=True).start()
    log.info(
        "ai worker starting",
        model=cfg.model,
        fast_model=cfg.fast_model,
        embed_model=cfg.embed_model,
        tts_model=cfg.tts_model,
        encrypt_content=cfg.encrypt_content,
        encrypt_addresses=cfg.encrypt_addresses,
        learn_model=cfg.learn_model,
        brief_model=cfg.brief_model,
        predraft_model=cfg.predraft_model,
        transcribe_model=cfg.transcribe_model,
        key_wrapping_key=bool(cfg.key_wrapping_key),  # whether it is set, never the key
        company_logos=cfg.company_logos,
    )
    try:
        while not stop.is_set():
            try:
                drafts.run_once()
            except Exception as err:
                log.error("draft loop failed", code=log.code_of(err))
            stop.wait(drafts.poll_wait())
    except KeyboardInterrupt:
        stop.set()
    stop.set()
    gemini.close()  # writes the usage rows still queued
    log.info("ai worker stopping")


if __name__ == "__main__":
    main()
