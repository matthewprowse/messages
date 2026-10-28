# apps/ai

The AI worker: Python 3.11+, standard library plus `cryptography`. It reads and writes Supabase with the service role and
calls Gemini. Read `../../AGENTS.md` and `../../docs/CONVENTIONS.md` first, then `README.md` here for behaviour in detail.

## Layout

| Path | Contents |
| --- | --- |
| `ai/__main__.py` | Entry (`pnpm ai`). Starts the draft loop and the triage, learning, brief and meetings threads. |
| `ai/triage.py`, `drafts.py`, `learn.py`, `voice.py`, `people.py`, `signals.py`, `chasers.py`, `brief.py`, `meetings.py`, `transcribe.py`, `embed.py`, `similar.py`, `company_voice.py`, `logos.py` | One module per behaviour. Each module's docstring says what it does and what it reads and writes. |
| `ai/gemini.py`, `pricing.py` | The only place that calls Gemini, and what each call costs. |
| `ai/supabase.py`, `http.py`, `retry.py`, `poll.py` | Database access, HTTP, retry and poll plumbing. |
| `ai/crypto.py`, `keys.py`, `vault.py`, `fields.py` | Field encryption (mirrors `packages/crypto`), per-user keys, sealing and opening. |
| `ai/connectors/instagram`, `icloud_reminders` | Python connectors, each with `run.py` (entry), `sync.py`, `client.py`, `mapping.py`, `store.py`. |
| `tests/test_<module>.py` | `unittest`, run with `pnpm test:ai`. |

## Working here

- One AI provider (Gemini) through `gemini.py`. Do not call it from other modules; add a function there.
- Never log message content or addresses. Log counts and ids.
- Encrypted columns must be opened before use and sealed before write. `crypto.py` must stay byte-compatible with
  `packages/crypto` (`packages/crypto/vectors.json` pins the format and both test suites read it).
- Ask the model only when its answer is used; read the cheaper signals first (see `triage.py`).
- Every behaviour change needs a test in `tests/`. Pass fakes for Supabase and Gemini; tests never touch the network.
