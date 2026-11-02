"""Company logos: the AI worker's part of the shared logo queue (supabase/migrations/20261031100000_company_logos.sql).
The sync worker gathers every candidate (the App Store, BIMI, the company's site, Google's favicon service,
Wikidata, Simple Icons), frames each as the round avatar it would become and saves them with one numbered
sheet. This only asks Gemini, with the fast model:

- judging: one call per company, with the sheet, the company's name and domain and where each candidate
  came from. Gemini passes or turns down each one with a reason and picks the best, or none.
- searching: when nothing passed, one call with Google Search grounding finds addresses of the official
  logo, which the sync worker frames and puts to the judge in the same way.

Spend is capped two ways, both shared by everyone: DEFAULT_DAILY_CAP steps a day and DEFAULT_DAILY_USD dollars
a day (LOGO_DAILY_USD). The dollar cap is read from the cost the logos feature records in ai_usage (at most
once a minute) and counted up from each step's own usage in between, so it holds across restarts. A grounded
search costs about $0.014 a query and runs one to three, so it is the dear step: with LOGO_SEARCH_GATE on, it
only runs for a domain that a non-bulk contact uses or that at least two users have (see search_worthwhile).

Only the company's name and domain are sent, never an address or any mail. Logos are shared by every
user, so their cost is Konva's own and is filed against the owner's account (feature "logos")."""

from __future__ import annotations

import re
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from . import log
from .gemini import Gemini, GeminiError, Usage, UsageContext
from .retry import billing_paused
from .supabase import Supabase

PER_RUN = 8
DEFAULT_DAILY_CAP = 200  # Gemini steps a day for logos, shared by everyone (LOGO_DAILY_CAP)
DEFAULT_DAILY_USD = 2.0  # dollars a day for logos, shared by everyone (LOGO_DAILY_USD); about 140 grounded queries
MIN_USERS_FOR_SEARCH = 2
DEFAULT_MAX_TRIES = 3  # failures of one company before it is given up (LOGO_MAX_TRIES)
RETRY_BACKOFF_S = 600  # after a failure: 10 minutes, then 20, then 40
GIVE_UP_DAYS = 30
CAP_CHECK_S = 60


def env_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, "") or default)
    except ValueError:
        return default
    return value if value > 0 else default


def env_float(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, "") or default)
    except ValueError:
        return default
    return value if value > 0 else default


MAX_SEARCH_URLS = 6
COLUMNS = "domain,name,status,round,candidates,sheet_path,rejected,excluded,gemini_calls,gemini_cost_usd,ai_tries"
# Read only once the migration that adds them has run (LOGO_SEARCH_GATE=true): users_seen is how many users have
# mail from the domain and personal_seen whether a contact there is not a bulk sender.
GATE_COLUMNS = ",users_seen,personal_seen"


def search_gate_on() -> bool:
    return os.environ.get("LOGO_SEARCH_GATE", "").strip().lower() == "true"


def search_worthwhile(row: dict[str, Any]) -> bool:
    """Whether a grounded search is worth its cost: the domain is used by a non-bulk contact, or at least
    MIN_USERS_FOR_SEARCH users have mail from it. A row without the counts (not read) is searched."""
    if row.get("users_seen") is None and row.get("personal_seen") is None:
        return True
    return bool(row.get("personal_seen")) or int(row.get("users_seen") or 0) >= MIN_USERS_FOR_SEARCH

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "candidates": {
            "type": "array",
            "description": "Every candidate on the sheet, in order.",
            "items": {
                "type": "object",
                "properties": {
                    "n": {"type": "integer"},
                    "passes": {"type": "boolean"},
                    "reason": {"type": "string", "description": "One short sentence: what it shows, and why it fails if it does."},
                },
                "required": ["n", "passes", "reason"],
            },
        },
        "pick": {"type": "integer", "description": "The number of the best candidate that passes, or 0 when none passes."},
        "reason": {"type": "string", "description": "One short sentence on why that one, or why none passed."},
    },
    "required": ["candidates", "pick", "reason"],
}

JUDGE_SYSTEM = """You choose the picture shown beside a company's emails in a mail app: a small round avatar,
often only 40 pixels across. You get one image of numbered candidates, each drawn exactly as the round
avatar it would become, with the company's name, its email domain, and where each candidate came from.
Look at every candidate, decide whether it passes, then pick the best one that passes, or 0 when none does.

A candidate passes only if all of these hold:
- It is this company's own logo. Not another company's (an app by a different publisher, a lookalike
  name). Not one of its products, apps or sub-brands (for Microsoft, not Outlook, Teams or Copilot; for
  Checkers, not Checkers Sixty60; for Telkom, not myTelkom), unless the domain shows the company is
  that product itself. Many companies are small and you will not know their logo: a candidate from
  the company's own website, its BIMI record or an app it publishes is its own unless it is plainly
  someone else's (a website builder's or host's default icon such as WordPress, Wix or Squarespace, or
  another brand's logo). Never turn one down only because you do not recognise it.
- It is the logo the company uses today, not one it has replaced. What the company's own website and
  BIMI record show is what it uses today.
- It is the plain logo: no promotional badge, ribbon or text such as NEW, SALE, a season or an event,
  and not a screenshot, photo, banner or social media preview.
- It is in the brand's real colours. A one-colour version of a logo that is normally in several
  colours fails (a flat grey or single-colour Slack, Instagram, Google or Amazon). A white mark on the
  brand's own colour passes when the brand shows itself that way.
- It is the brand's symbol or app icon, or its full logo. A text-only wordmark fails when the brand also
  has a symbol or icon of its own (as Dis-Chem, Cotton On and FlySafair do), even if no candidate shows
  it, and also fails when its letters would be unreadable at 40 pixels. A partial logo (a cropped piece,
  or one letter of a wordmark that the company never shows alone) fails; a letter or monogram the
  company itself uses as its icon, on its website or in its app, is its symbol.
- It is whole, centred and clear of the circle's edge: nothing cut off, touching or crowding the edge,
  and not so small it is lost.
- It is sharp: not blurred, blocky or pixelated, and not a generic placeholder (a globe, a blank page,
  a default icon). A letter or monogram the company's own site uses is its logo when it looks designed.

Among those that pass, prefer in this order:
1. The brand's own symbol or app icon in full colour, as people know it today (Netflix's red N,
   YouTube's red play button, Facebook's big f, Spotify's green circle). A wordmark never wins over a
   symbol or icon that passes.
2. The full-colour, detailed version over a flat or simplified one.
3. The sharper and better centred of two that are otherwise the same.
Where a candidate came from is only a clue to what it is."""

SEARCH_SYSTEM = """You find a company's official logo on the web for a mail app's company avatar. The name may only
have been made from its email domain ("Workablemail" for workablemail.com, a domain the company Workable
sends mail from; "Myuct" for myuct.ac.za, the University of Cape Town's): work out which company or
organisation it is first. Search for its own brand, media or press page, its App Store or Google Play
listing, and its Wikipedia or Wikimedia Commons page. Answer with up to five direct addresses (https) of
image files (PNG, SVG, JPG or WebP) showing its current logo, best first: its symbol or app icon in full
colour if it has one, otherwise its full logo. Prefer addresses on its own website, Wikimedia and the
app stores: logo collection sites (seeklogo, 1000logos, logo.dev and the like) turn apps away. Then give
the address of its official website's home page. One address per line and nothing else. Give only
addresses you saw in the search results; never make one up."""

LAST_LOOK = """This is the last look, after a web search; the earlier candidates are included again. If none is
ideal, pick the best one that is still this company's own, whole, sharp and readable, even a wordmark
or a one-colour version: a logo is better than none. Pick 0 only when every candidate fails for another
reason."""


def candidates_text(candidates: list[dict[str, Any]]) -> str:
    """Where each candidate came from, one line each, as the judge reads it."""
    sources = {
        "app_store": "the App Store",
        "bimi": "the company's BIMI mail logo",
        "site": "an icon on the company's website",
        "google": "Google's favicon service",
        "wikidata": "Wikidata",
        "simple_icons": "Simple Icons (one colour only)",
        "search": "Google Search",
    }
    lines = []
    for c in candidates:
        note = str(c.get("note") or "").strip()
        lines.append(f"{c['n']}: {note or sources.get(str(c.get('source')), str(c.get('source')))}")
    return "\n".join(lines)


def judge_prompt(name: str, domain: str, candidates: list[dict[str, Any]], last_look: bool = False) -> str:
    prompt = f"Company: {name}\nDomain: {domain}\n\nCandidates on the sheet:\n{candidates_text(candidates)}"
    return f"{prompt}\n\n{LAST_LOOK}" if last_look else prompt


def read_verdict(answer: dict[str, Any], candidates: list[dict[str, Any]]) -> tuple[int | None, str, list[dict[str, Any]]]:
    """(pick, reason, turned down) from the judge's answer. A pick that is not on the sheet, or that the
    judge itself said fails, counts as none."""
    numbers = {int(c["n"]): c for c in candidates}
    verdicts = {int(v.get("n") or 0): v for v in answer.get("candidates") or [] if isinstance(v, dict)}
    try:
        pick = int(answer.get("pick") or 0)
    except (TypeError, ValueError):
        pick = 0
    if pick not in numbers or verdicts.get(pick, {}).get("passes") is False:
        pick = 0
    rejected = [
        {"n": n, "source": c.get("source"), "url": c.get("url"), "path": c.get("path"), "reason": str(verdicts.get(n, {}).get("reason") or "No reason given.")[:300]}
        for n, c in numbers.items()
        if n != pick
    ]
    return (pick or None), str(answer.get("reason") or "")[:300], rejected


def search_urls(text: str, pages: list[str], excluded: list[str]) -> list[str]:
    """Image addresses from the search answer first, then the pages it drew on, each once, without ones turned down."""
    found = [u.rstrip(".,;)]>\"'") for u in re.findall(r"https://[^\s<>\"')\]]+", text)]
    out: list[str] = []
    for url in found + pages[:3]:
        if url not in out and url not in excluded:
            out.append(url)
    return out[:MAX_SEARCH_URLS]


class Logos:
    def __init__(self, db: Supabase, gemini: Gemini, model: str):
        self._db = db
        self._gemini = gemini
        self._model = model
        self._owner: str | None = None
        self._cap = env_int("LOGO_DAILY_CAP", DEFAULT_DAILY_CAP)
        self._max_tries = env_int("LOGO_MAX_TRIES", DEFAULT_MAX_TRIES)
        self._cap_usd = env_float("LOGO_DAILY_USD", DEFAULT_DAILY_USD)
        self._made: tuple[float, int] | None = None
        self._dollars: tuple[str, float] | None = None  # (UTC day, dollars spent that day), counted up between reads

    def _calls_today(self) -> int:
        """Logo steps made today (UTC), from ai_usage, read at most once a minute and counted up between reads."""
        now = time.monotonic()
        if self._made is None or now - self._made[0] > CAP_CHECK_S:
            midnight = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            self._made = (now, self._db.count("ai_usage", {"feature": "eq.logos", "created_at": f"gte.{midnight.isoformat()}"}))
            rows = self._db.select("ai_usage", {"select": "cost_usd", "feature": "eq.logos", "created_at": f"gte.{midnight.isoformat()}", "limit": "5000"})
            self._dollars = (midnight.date().isoformat(), sum(float(r.get("cost_usd") or 0) for r in rows))
        return self._made[1]

    def _usd_today(self) -> float:
        today = datetime.now(timezone.utc).date().isoformat()
        if self._dollars is None or self._dollars[0] != today:
            self._dollars = (today, 0.0)  # a new day starts again from the next read
        return self._dollars[1]

    def _add_spend(self, usd: float) -> None:
        self._dollars = (self._dollars[0], self._dollars[1] + usd) if self._dollars else (datetime.now(timezone.utc).date().isoformat(), usd)

    def _usage(self) -> UsageContext:
        if self._owner is None:
            self._owner = str(self._db.rpc("analytics_owner_id", {}) or "")
        if not self._owner:
            raise RuntimeError("no owner account for logo usage")
        return UsageContext(user_id=self._owner, feature="logos")

    def run_once(self) -> int:
        """Judges and searches for the companies waiting, oldest first. Returns how many were done."""
        try:
            used = self._calls_today()
        except Exception as err:  # the cap cannot be checked: wait, as the allowance checks do
            log.warn("logo cap not checked", code=log.code_of(err))
            return 0
        if used >= self._cap or self._usd_today() >= self._cap_usd:
            return 0  # the day's share of lookups is used; the queue waits until midnight UTC
        now = datetime.now(timezone.utc).isoformat()
        rows = self._db.select(
            "company_logos",
            {
                "select": COLUMNS + (GATE_COLUMNS if search_gate_on() else ""),
                "status": "in.(judging,searching)",
                "or": f"(ai_next_try_at.is.null,ai_next_try_at.lte.{now})",
                "order": "updated_at.asc",
                "limit": str(min(PER_RUN, self._cap - used)),
            },
        )
        done = 0
        for row in rows:
            if self._usd_today() >= self._cap_usd:
                break  # spent the day's dollars part way through
            if self._made:
                self._made = (self._made[0], self._made[1] + 1)
            try:
                if row["status"] == "judging":
                    self.judge(row)
                else:
                    self.search(row)
                done += 1
            except GeminiError as err:
                log.warn("logo step failed", step=row["status"], status=err.status)
                self._failed(row, paused="budget_" in str(err) or billing_paused(err))
            except Exception as err:
                log.error("logo step failed", step=row["status"], code=log.code_of(err))
                self._failed(row)
        return done

    def _failed(self, row: dict[str, Any], paused: bool = False) -> None:
        """Counts a failed step. After the maximum the company is given up for GIVE_UP_DAYS (done, no logo); until
        then it waits longer each time. A budget pause is not the company's fault and is not counted."""
        domain = row["domain"]
        now = datetime.now(timezone.utc)
        if paused:
            self._patch(domain, {"ai_next_try_at": (now + timedelta(seconds=RETRY_BACKOFF_S)).isoformat()})
            return
        tries = int(row.get("ai_tries") or 0) + 1
        if tries >= self._max_tries:
            log.warn("logo given up", tries=tries)
            self._patch(
                domain,
                {
                    "status": "done",
                    "path": None,
                    "ai_tries": 0,
                    "ai_next_try_at": None,
                    "ai_retry_after": (now + timedelta(days=GIVE_UP_DAYS)).isoformat(),
                    "checked_at": now.isoformat(),
                },
            )
            return
        self._patch(domain, {"ai_tries": tries, "ai_next_try_at": (now + timedelta(seconds=RETRY_BACKOFF_S * 2 ** (tries - 1))).isoformat()})

    def _patch(self, domain: str, patch: dict[str, Any]) -> None:
        try:
            self._db.update("company_logos", {"domain": f"eq.{domain}"}, {**patch, "updated_at": datetime.now(timezone.utc).isoformat()}, minimal=True)
        except Exception as err:
            log.warn("logo row not updated", code=log.code_of(err))

    def judge(self, row: dict[str, Any]) -> None:
        candidates = row.get("candidates") or []
        sheet = self._db.download("logos", row["sheet_path"])
        last_look = int(row.get("round") or 1) == 2
        spent: list[Usage] = []
        answer = self._gemini.json(
            self._model,
            JUDGE_SYSTEM,
            judge_prompt(row["name"], row["domain"], candidates, last_look),
            JUDGE_SCHEMA,
            self._usage(),
            temperature=0,
            thinking="low",
            image=(sheet, "image/png"),
            spent=spent,
        )
        pick, reason, rejected = read_verdict(answer, candidates)
        if last_look:  # the first look's verdicts on candidates not shown again are kept
            shown = {c.get("path") for c in candidates}
            rejected = [r for r in row.get("rejected") or [] if r.get("path") not in shown] + rejected
        self._save(row, spent, status="judged", pick=pick, verdict=reason, rejected=rejected)

    def search(self, row: dict[str, Any]) -> None:
        if search_gate_on() and not search_worthwhile(row):
            # Not worth about $0.014 a query: the company keeps its first letter, and is looked at again after GIVE_UP_DAYS.
            now = datetime.now(timezone.utc)
            self._patch(row["domain"], {"status": "done", "path": None, "ai_tries": 0, "ai_next_try_at": None, "ai_retry_after": (now + timedelta(days=GIVE_UP_DAYS)).isoformat(), "checked_at": now.isoformat()})
            return
        spent: list[Usage] = []
        text, pages = self._gemini.search(
            self._model,
            SEARCH_SYSTEM,
            f"Company: {row['name']}\nDomain: {row['domain']}",
            self._usage(),
            spent=spent,
        )
        urls = search_urls(text, pages, row.get("excluded") or [])
        self._save(row, spent, status="queued", round=2, search_urls=urls)

    def _save(self, row: dict[str, Any], spent: list[Usage], **patch: Any) -> None:
        cost = float(row.get("gemini_cost_usd") or 0) + sum(u.cost_usd for u in spent)
        self._add_spend(sum(u.cost_usd for u in spent))
        self._db.update(
            "company_logos",
            {"domain": f"eq.{row['domain']}"},
            {
                **patch,
                "ai_tries": 0,
                "ai_next_try_at": None,
                "gemini_calls": int(row.get("gemini_calls") or 0) + len(spent),
                "gemini_cost_usd": round(cost, 6),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            minimal=True,
        )

    def _touch(self, domain: str) -> None:
        try:
            self._db.update("company_logos", {"domain": f"eq.{domain}"}, {"updated_at": datetime.now(timezone.utc).isoformat()}, minimal=True)
        except Exception:
            pass


def main() -> None:
    """Works through the logo queue's Gemini steps until none are waiting, then stops: for the backfill and
    test runs (apps/worker/scripts/company-logos.ts). The AI worker does the same as it runs, when
    COMPANY_LOGOS is on."""
    from . import config

    cfg = config.load()
    db = Supabase(cfg.supabase_url, cfg.service_role_key)
    logos = Logos(db, Gemini(cfg.gemini_api_key, db), cfg.fast_model)
    while logos.run_once():
        pass
