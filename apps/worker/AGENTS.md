# apps/worker

The always-on sync worker (Node 24, `tsx`). It uses the Supabase **service role**, which bypasses row level security:
every query must scope by account or user explicitly. Read `../../AGENTS.md` and `../../docs/CONVENTIONS.md` first.

## Layout

| Path | Contents |
| --- | --- |
| `src/index.ts` | Entry. Every 30 s reconciles running connectors with the `accounts` table, and hands queued work to them. |
| `src/runtime/` | What `index.ts` runs: `reconcile.ts` (connectors vs accounts), `queues.ts` (Realtime and poll) with the `dispatch-*.ts` handlers, `registry.ts` (provider to connector), `state.ts`, `maintenance.ts`, `shutdown.ts`. |
| `src/connectors/<name>.ts` | One connector per provider (gmail, outlook, imap, icloud, whatsapp, linkedin, teams, zoom, google-*, outlook-calendar, icloud-calendar, microsoft-todo). A connector does I/O and scheduling only. |
| `src/google/`, `microsoft/`, `whatsapp/`, `imap/`, `linkedin/`, `caldav/`, `teams/`, `zoom/` | Each provider's client, OAuth, mapping and parsing: the pure, tested parts a connector calls. |
| `src/ingest/` | Normalising and storing incoming email, attachments and folder status. |
| `src/send/` | The outbox: composing, sending, unsubscribe flow, attachment rules. |
| `src/calendar/`, `src/tasks/` | Queued calendar event and task writes (create, update, delete, tick). |
| `src/share/` | Team sharing, shared chats and team key rotation jobs. |
| `src/contacts/`, `meetings/`, `photos/`, `logos/` | Background linkers and sync jobs. |
| `src/db.ts`, `env.ts`, `log.ts`, `polling.ts`, `backoff.ts`, `util.ts` | Shared plumbing: client, settings, logging, poll cadence, retry, helpers. |
| `src/vault.ts`, `crypto.ts` | Sealing and opening encrypted columns. |
| `scripts/` | One-off CLI tools (`connect-*.ts`, `encrypt-*.ts`, `set-password.ts`). Run through `pnpm` scripts in `package.json`. |

## Working here

- A new provider: add `connectors/<name>.ts` (I/O) and `<name>/` (client, mapping, tests), register it in `src/index.ts`,
  and add a `connect:<name>` script only if it needs a terminal step (users connect in the web app).
- Put parsing, mapping and decision logic in the provider folder with a `*.test.ts`. Connectors are not unit tested;
  their helpers are. Tests never call a real provider.
- Respect provider limits: use `Backoff` and `polling.ts`; map provider failures to a stable `code` and let the
  connector decide whether to back off or mark the account as needing reconnection.
- Never log message content, names, addresses or tokens. `log.ts` is structured; use codes.
- Run: `pnpm worker` (root). Tests: `pnpm --filter worker test`.
