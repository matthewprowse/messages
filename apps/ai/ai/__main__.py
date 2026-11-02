"""Runs the AI worker: drafts are checked every second and a half, and every half second while drafts
are being asked for, so they feel instant; several are written at once. Triage and learning run
alongside in their own thread. Stop with Ctrl+C.

Learning keeps layered memory fresh: your voice (re-learned every 10 sent emails), notes on each
person and company, rules from the tones, instructions and guided drafting choices you pick, and
embeddings of every email for finding how you answered similar ones. The spoken daily brief is written
in a thread of its own, and so are meetings (recordings transcribed, transcripts summarised), as an hour's
recording can take minutes. A readable version of a newsletter is made, in a thread of its own, when someone opens it."""

from __future__ import annotations

import signal
import sys
import threading
import time

from . import config, log
from .brief import IDLE_S as BRIEF_IDLE_S, POLL_S as BRIEF_POLL_S, Brief
from .batching import BatchQueue
from .bulk_read import BulkRead
from .chasers import Chasers
from .documents import Documents
from .claims import Claims
from .drafts import Drafts
from .embed import Embeddings
from .gemini import Gemini
from .learn import Learn
from .lease import Lease
from .logos import Logos
from .meetings import Meetings
from .people import People
from .people_card import ClientCards
from .poll import Backoff
from .prep import Prep
from .matter_job import MatterJob
from .pricing import unpriced
from .signals import Signals
from .supabase import Supabase, missing_relation
from .transcribe import Transcribe
from .triage import Triage
from .vault import Vault
from .voice import Voice

DRAFT_IDLE_MAX_S = 1.0  # an idle draft poll never waits longer: a requested draft starts within about a second (Realtime would need a websocket client; one indexed read a second is cheap)
TRIAGE_IDLE_S = 15
TRIAGE_IDLE_CEILING_S = 60  # an idle triage looks 15 s, 30 s, then every 60 s, and every 15 s again once it or a job finds work
LEARN_EVERY_S = 60
VOICE_EVERY_S = 300  # only checks who is due: a user is relearned once they have sent 10 more emails
SIGNALS_EVERY_S = 3600  # each user is rechecked hourly at most (signals.RECHECK_S), so reading more often only wastes the read
CARDS_EVERY_S = 600  # client cards: a look for new activity and Refresh asks, at most one call each per contact a day
MATTER_EVERY_S = 1800  # Same Matter suggestions: links are a convenience, so half-hourly is plenty
PREP_EVERY_S = 120  # meeting prep is built 30 minutes before a start, so this is the most it can be late
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
BULK_READ_EVERY_S = 1.5  # someone is waiting on a readable version they just opened: this is the cadence once a request is found
# Idle, it looks 1.5s, 3s, 6s ... up to this. 30s keeps an idle worker to 2 looks a minute; a request made after a
# long quiet spell can wait that long for its first look, then the readable version takes a few seconds.
BULK_READ_IDLE_S = 30


def main() -> None:
    if sys.argv[1:2] == ["instagram"]:  # Instagram direct messages, a process of its own (pnpm instagram)
        from .connectors.instagram.run import main as instagram

        instagram()
        return
    if sys.argv[1:2] == ["linkedin"]:  # the LinkedIn helper the sync worker starts per account, JSON lines on stdin and stdout
        from .connectors.linkedin.run import main as linkedin

        linkedin()
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
    for model in unpriced([cfg.model, cfg.fast_model, cfg.embed_model, cfg.tts_model, cfg.learn_model, cfg.brief_model, cfg.predraft_model, cfg.transcribe_model]):
        log.error("configured model has no entry in pricing.PRICES, its calls are billed at the dearest known price", model=model)
    db = Supabase(cfg.supabase_url, cfg.service_role_key)
    vault = Vault(db, cfg.key_wrapping_key, cfg.encrypt_content)  # one key cache shared by every job
    lease = Lease(db)
    if not lease.acquire():
        log.error("another ai worker holds the lease, not starting")
        sys.exit(1)
    gemini = Gemini(cfg.gemini_api_key, db)
    claims = Claims(db)  # a row is claimed before it is paid for, so a second worker (a mistaken start, an overlapping restart) skips it
    embeddings = Embeddings(db, gemini, cfg.embed_model, vault)
    drafts = Drafts(db, gemini, cfg.model, embeddings, vault, fast_model=cfg.fast_model, predraft_model=cfg.predraft_model)
    drafts.claims = claims
    triage = Triage(db, gemini, cfg.triage_model, vault)
    triage.harden(BatchQueue(db, gemini, "triage") if config.batch_enabled() else None, claims)  # retry state in the database, claims, setup triage as a batch
    learn = Learn(db, gemini, cfg.learn_model, vault)
    if config.batch_enabled():
        learn.batches = BatchQueue(db, gemini, "learn")
    transcribe = Transcribe(db, gemini, cfg.model, vault)
    transcribe.claims = claims
    # (name, every seconds, job): each runs when due, one after another, between triage batches.
    jobs = [
        ("transcribe", TRANSCRIBE_EVERY_S, transcribe.run_once),
        ("learn", LEARN_EVERY_S, learn.run_once),
        ("voice", VOICE_EVERY_S, Voice(db, gemini, cfg.learn_model, vault).run_once),
        ("signals", SIGNALS_EVERY_S, Signals(db, gemini, cfg.learn_model, vault).run_once),
        ("people", PEOPLE_EVERY_S, People(db, gemini, cfg.learn_model, cfg.fast_model, vault).run_once),
        ("cards", CARDS_EVERY_S, ClientCards(db, gemini, cfg.fast_model, vault).run_once),
        ("prep", PREP_EVERY_S, Prep(db, vault).run_once),
        ("matter", MATTER_EVERY_S, MatterJob(db, vault, embeddings.index).run_once),
        ("embed", EMBED_EVERY_S, embeddings.run_once),
        ("follow_ups", FOLLOW_UPS_EVERY_S, Chasers(db, gemini, cfg.model, vault).run_once),  # the full model: the fast one called none of the test conversations waiting
    ]
    if cfg.company_logos:  # off until the logo system is rolled out (docs/PLAN.md, Company Logos)
        jobs.append(("logos", LOGOS_EVERY_S, Logos(db, gemini, cfg.fast_model).run_once))
    stop = threading.Event()

    def background() -> None:
        last = {name: 0.0 for name, _, _ in jobs}
        waits = {name: Backoff(every, IDLE_CEILING_S.get(name, every)) for name, every, _ in jobs}
        due = {name: every for name, every, _ in jobs}  # seconds to wait since the job last ran
        triage_wait = Backoff(TRIAGE_IDLE_S, TRIAGE_IDLE_CEILING_S)
        triage_at = 0.0  # when triage looks next (time.monotonic)
        while not stop.is_set():
            busy = 0
            if time.monotonic() >= triage_at:
                try:
                    busy = triage.run_once()
                    triage_at = time.monotonic() + triage_wait.next(busy > 0)
                except Exception as err:
                    triage_at = time.monotonic() + TRIAGE_IDLE_S
                    log.error("triage loop failed", code=log.code_of(err))
            for name, every, job in jobs:
                if stop.is_set() or time.monotonic() - last[name] <= due[name]:
                    continue
                last[name] = time.monotonic()
                try:
                    found = job()
                    worked = not isinstance(found, int) or found > 0
                    due[name] = waits[name].next(worked)
                    if isinstance(found, int) and found > 0:  # a transcript, embedding or note may be what triage is waiting for
                        triage_wait.reset()
                        triage_at = 0.0
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

    bulk_read = BulkRead(db, gemini, cfg.triage_model, vault)

    def bulk_reads() -> None:
        """A readable version is asked for by someone looking at the email, so it has a thread of its own and is
        looked for quickly, then every BULK_READ_IDLE_S while nothing is asked."""
        wait = Backoff(BULK_READ_EVERY_S, BULK_READ_IDLE_S)
        while not stop.is_set():
            found = True
            try:
                found = bulk_read.run_once() > 0
            except Exception as err:
                if missing_relation(err):  # the bulk_reads migration is not applied yet
                    stop.wait(600)
                    continue
                log.error("bulk read loop failed", code=log.code_of(err))
            stop.wait(wait.next(found))

    documents = Documents(db, gemini, cfg.triage_model, vault)  # document cards: a thread of its own, as a PDF read takes seconds

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
    lease.keep(stop, stop.set)  # renewed in the background; losing it stops the worker rather than run twice
    threading.Thread(target=background, name="triage", daemon=True).start()
    threading.Thread(target=briefs, name="brief", daemon=True).start()
    threading.Thread(target=meeting_steps, name="meetings", daemon=True).start()
    threading.Thread(target=bulk_reads, name="bulk_read", daemon=True).start()
    threading.Thread(target=documents.loop, args=(stop,), name="documents", daemon=True).start()
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
            stop.wait(min(drafts.poll_wait(), DRAFT_IDLE_MAX_S))
    except KeyboardInterrupt:
        stop.set()
    stop.set()
    gemini.close()  # writes the usage rows still queued
    lease.release()
    log.info("ai worker stopping")


if __name__ == "__main__":
    main()
