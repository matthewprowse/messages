"""Settings from apps/ai/.env (or the environment). Nothing secret is ever logged."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Config:
    supabase_url: str
    service_role_key: str
    gemini_api_key: str
    model: str
    fast_model: str
    embed_model: str
    tts_model: str
    tts_voice: str
    key_wrapping_key: str  # base64, 32 bytes; without it encrypted values cannot be opened
    encrypt_content: bool  # writes are encrypted only when ENCRYPT_CONTENT is "true"
    company_logos: bool  # the shared company logo queue is worked on only when COMPANY_LOGOS is "true"
    encrypt_addresses: bool  # addresses are sealed unless ENCRYPT_ADDRESSES is "false"
    learn_model: str  # voice, edit and signal learning, and notes on people: the cheaper model unless LEARN_MODEL says otherwise
    brief_model: str  # the brief script: the cheaper model unless BRIEF_MODEL says otherwise
    predraft_model: str  # automatic pre-drafts: the cheaper model unless PREDRAFT_MODEL says otherwise
    triage_model: str  # triage of each new message: the cheaper model unless TRIAGE_MODEL says otherwise (for an A/B of a cheaper one)
    transcribe_model: str  # meeting recordings: GEMINI_TRANSCRIBE_MODEL, else the full model (see meetings.py)


def flag_on(name: str, default: bool = True) -> bool:
    """A switch that is on unless the variable says false (off, no and 0 also read as off). Unset or empty is the default."""
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw not in ("false", "off", "no", "0")


THINKING_LEVELS = ("minimal", "low", "medium", "high")


def thinking_level(name: str, default: str) -> str:
    """A thinking level for one job from the environment, so the owner can A/B it without a deploy. Anything
    that is not a level gemini.py knows reads as the default."""
    raw = os.environ.get(name, "").strip().lower()
    return raw if raw in THINKING_LEVELS else default


def draft_thinking() -> str:
    """Manual drafts and tones on the full model: DRAFT_THINKING, low unless set."""
    return thinking_level("DRAFT_THINKING", "low")


def edit_thinking() -> str:
    """Edits of text you wrote (not tone adjustments): EDIT_THINKING, medium unless set (low let typos through)."""
    return thinking_level("EDIT_THINKING", "medium")


def describe_jobs(cfg: Config) -> dict[str, str]:
    """Each job's model and thinking level, for the startup log. Levels the code fixes are written as they are."""
    return {
        "draft": f"{cfg.model}/{draft_thinking()}",
        "edit": f"{cfg.fast_model}/{edit_thinking()}",
        "predraft": f"{cfg.predraft_model}/{draft_thinking()}",
        "triage": f"{cfg.triage_model}/minimal",
        "learn": f"{cfg.learn_model}/low (people notes minimal)",
        "brief": f"{cfg.brief_model}",
        "transcribe": f"{cfg.transcribe_model}/minimal",
        "chasers": f"{cfg.model}/low",
        "bulk_read": f"{cfg.triage_model}/minimal",
    }


def production() -> bool:
    return any(os.environ.get(n, "").strip().lower() == "production" for n in ("APP_ENV", "ENVIRONMENT", "NODE_ENV", "PYTHON_ENV"))


def check_encryption(content: bool, addresses: bool, *, prod: bool | None = None) -> None:
    """Exits when production would run with encryption explicitly switched off. Off is only allowed outside production."""
    if (production() if prod is None else prod) and not (content and addresses):
        off = [n for n, v in (("ENCRYPT_CONTENT", content), ("ENCRYPT_ADDRESSES", addresses)) if not v]
        print(f"Refusing to start in production with {' and '.join(off)} switched off", file=sys.stderr)
        sys.exit(1)


def batch_enabled() -> bool:
    """The half price Batch API for setup triage and learning backlogs is on unless AI_BATCH is "off"."""
    return os.environ.get("AI_BATCH", "").strip().lower() not in ("off", "false", "0")


def load() -> Config:
    _load_env_file(Path(__file__).resolve().parent.parent / ".env")

    def required(name: str) -> str:
        value = os.environ.get(name, "").strip()
        if not value:
            print(f"Missing {name} in apps/ai/.env", file=sys.stderr)
            sys.exit(1)
        return value

    encrypt_content = flag_on("ENCRYPT_CONTENT")
    encrypt_addresses = flag_on("ENCRYPT_ADDRESSES")
    check_encryption(encrypt_content, encrypt_addresses)
    model = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
    fast_model = os.environ.get("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite")
    cfg = Config(
        supabase_url=required("SUPABASE_URL"),
        service_role_key=required("SUPABASE_SERVICE_ROLE_KEY"),
        gemini_api_key=required("GEMINI_API_KEY"),
        model=model,
        fast_model=fast_model,
        embed_model=os.environ.get("GEMINI_EMBED_MODEL", "gemini-embedding-2"),
        tts_model=os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts"),
        tts_voice=os.environ.get("GEMINI_TTS_VOICE", "Kore"),
        key_wrapping_key=os.environ.get("KEY_WRAPPING_KEY", "").strip(),
        encrypt_content=encrypt_content,
        company_logos=os.environ.get("COMPANY_LOGOS", "").strip().lower() == "true",
        encrypt_addresses=encrypt_addresses,
        learn_model=os.environ.get("LEARN_MODEL", "").strip() or fast_model,
        brief_model=os.environ.get("BRIEF_MODEL", "").strip() or fast_model,
        predraft_model=os.environ.get("PREDRAFT_MODEL", "").strip() or fast_model,
        triage_model=os.environ.get("TRIAGE_MODEL", "").strip() or fast_model,
        transcribe_model=os.environ.get("GEMINI_TRANSCRIBE_MODEL", "").strip() or model,
    )
    log_cost_settings(cfg)
    return cfg


def log_cost_settings(cfg: Config) -> None:
    """One info line at startup with every job's model and thinking level and the next price change, so a
    price rise (the doubling on 2027-01-01) and a model switch are both visible in the logs."""
    from . import log, pricing

    change = pricing.next_price_change(date.today())
    log.info("ai jobs", **describe_jobs(cfg), next_price_change=change.isoformat() if change else None)
