"""Settings from apps/ai/.env (or the environment). Nothing secret is ever logged."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
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


def load() -> Config:
    _load_env_file(Path(__file__).resolve().parent.parent / ".env")

    def required(name: str) -> str:
        value = os.environ.get(name, "").strip()
        if not value:
            print(f"Missing {name} in apps/ai/.env", file=sys.stderr)
            sys.exit(1)
        return value

    return Config(
        supabase_url=required("SUPABASE_URL"),
        service_role_key=required("SUPABASE_SERVICE_ROLE_KEY"),
        gemini_api_key=required("GEMINI_API_KEY"),
        model=os.environ.get("GEMINI_MODEL", "gemini-3.8-flash"),
        fast_model=os.environ.get("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite"),
        embed_model=os.environ.get("GEMINI_EMBED_MODEL", "gemini-embedding-2"),
        tts_model=os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts"),
        tts_voice=os.environ.get("GEMINI_TTS_VOICE", "Kore"),
        key_wrapping_key=os.environ.get("KEY_WRAPPING_KEY", "").strip(),
        encrypt_content=os.environ.get("ENCRYPT_CONTENT", "").strip().lower() == "true",
    )
