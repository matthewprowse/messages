# AGENTS.md

Guide for coding agents (and people) working in this repo. Read this first, then the `AGENTS.md` in the folder you
are changing. The product is called Konva; the repo, packages and some app copy still say "Messages".

## What this is

One inbox for client conversations: email (Gmail, Outlook, iCloud, IMAP), WhatsApp, LinkedIn, Instagram, calendars,
tasks and meetings, with AI triage and drafts in the user's own voice. Product decisions live in `docs/PLAN.md`.

## Repo map

| Path | What lives there | Language |
| --- | --- | --- |
| `apps/web` | The Next.js app (App Router, shadcn/ui). The only thing users see. | TypeScript |
| `apps/worker` | Always-on sync worker: connectors, outbox sending, calendar/task writes, sharing jobs. | TypeScript |
| `apps/ai` | AI worker: triage, drafts, learning, daily brief, meetings, Instagram and iCloud Reminders connectors. Calls Gemini. | Python |
| `apps/linkedin` | Small bridge around mautrix-linkedin, driven by the worker. | Go |
| `packages/crypto` | Field encryption shared by browser, worker and AI worker (`apps/ai/ai/crypto.py` mirrors it). | TypeScript |
| `packages/db` | Generated Supabase types (`database.types.ts`). Never edit by hand. | TypeScript |
| `packages/email-text` | Turning email HTML and quoted replies into plain text. | TypeScript |
| `packages/mail-servers` | IMAP/SMTP server discovery and probing. | TypeScript |
| `packages/analytics` | Content-free analytics event types. | TypeScript |
| `packages/qr` | QR code generation. | TypeScript |
| `deploy` | Production: Compose file for the workers' VM, and scripts to create it, push env and release. See `docs/RUNBOOK.md`. | Shell |
| `supabase/migrations` | SQL migrations, named `YYYYMMDDHHMMSS_name.sql`. | SQL |
| `docs/PLAN.md` | Product plan and every agreed decision. | Markdown |

## How the pieces talk

The web app, worker and AI worker never call each other. They share one Supabase database and meet in its tables:

1. The web app writes rows (an `outbox` row for a reply, a `drafts` row for a draft request, a `task_updates` row for a
   ticked task). Row level security scopes everything to the signed-in user.
2. The worker or AI worker claims the row (service role), does the work, and writes the result back.
3. Supabase Realtime pushes the change to the web app (`apps/web/lib/app-store/use-realtime.ts`).

So a feature that spans apps is a table plus a migration plus a writer plus a reader. Start from the table.

## Commands

Run from the repo root.

| Command | What it does |
| --- | --- |
| `pnpm install` | Install everything. |
| `pnpm dev` | Web app on `localhost:3000`. The user usually has this running already: check before starting one. |
| `pnpm worker` | Sync worker (needs `apps/worker/.env`). |
| `pnpm ai` | AI worker (needs `apps/ai/.env`). |
| `pnpm lint` | Biome lint over web, worker and packages. |
| `pnpm typecheck` | `tsc --noEmit` in every package. |
| `pnpm test` | Node test runner in every package (web, worker, packages). |
| `pnpm test:ai` | Python `unittest` for the AI worker. |
| `pnpm check` | All of the above. Run it before saying work is done. |
| `pnpm --filter @messages/db gen:types` | Regenerate `database.types.ts` after a migration. |

CI (`.github/workflows/ci.yml`) runs the same checks.

## Rules for every change

- **Match the surrounding code.** The formatter is off on purpose (the code is hand-formatted and dense); copy the style
  of the file you are in. Lint is correctness only.
- **Comment the way `docs/CONVENTIONS.md` says.** Every source file starts with a header comment saying what it is for.
  Comments explain why, not what.
- **Keep files focused.** One concern per file. Aim for under 400 lines; split before 600. A new feature gets its own
  file or folder, not another 200 lines in a big one.
- **Tests sit next to the code** (`thing.ts` and `thing.test.ts`; Python tests are in `apps/ai/tests`). Put logic that
  needs testing in a plain module, not inside a component or a connector's I/O loop.
- **Decisions go in `docs/PLAN.md`.** When the user agrees something, record it there in the same change.
- **Migrations are append only.** Add a new file; never edit one that has been applied. Regenerate types afterwards.

## Product and safety rules (from the owner)

- **Never send anything while testing.** No outgoing emails, WhatsApps or replies, and do not bulk-open chats (read
  receipts are on). Test email features against real mail read-only, and look at them rendered in a browser.
- **Never kill processes by pattern.** No `pkill -f` or `killall`. Kill by exact PID only.
- **Use the dev server on `localhost:3000`.** Do not start another one on a different port.
- **The Supabase project for this app is `bbfahndgnmdlehicmphe`.** The Marketing project is separate: never touch it.
- **Privacy is architecture.** Message text, names and addresses are encrypted per user (`packages/crypto`). Analytics
  are content free: counts and screens, never text. Never log message content or addresses.
- **Connect accounts in the web page only.** No companion Mac apps, extensions or terminal-only flows for users.
- **Keys and `.env` files are never committed.** `.env.example` documents each variable.

## UI rules

- Stock shadcn/ui (`apps/web/components/ui`), ChatGPT/Vercel look. Do not restyle the primitives; compose them.
- No em dashes or en dashes anywhere in app text, mocks or docs. Labels, buttons and headings are Title Case.
- Dialogs: `showCloseButton={false}` and a plain button row in the footer. Use the stock shadcn pickers.
- Onboarding shows value (dialogs demoing drafts, the AI profile, merges), never a basic popover tour.
- If a UI instruction is ambiguous, do the clear parts and ask about the rest. Do not guess styling.

## Finding things

- A web screen: `apps/web/app/<route>/page.tsx`, its parts in `apps/web/components/`, its data in `apps/web/lib/`.
- Global app state: `apps/web/lib/store.tsx` (provider) with the reducer and helpers in `apps/web/lib/app-store/`.
- A connector (Gmail, Outlook, WhatsApp...): `apps/worker/src/connectors/<name>.ts`, with its pure helpers in the
  matching folder (`google/`, `microsoft/`, `whatsapp/`, ...). The connector does I/O; the folder does parsing and mapping.
- An AI behaviour (triage, drafts, brief): `apps/ai/ai/<name>.py`, tests in `apps/ai/tests/test_<name>.py`.
- A database column or table: `supabase/migrations`, then `packages/db/src/database.types.ts`.
