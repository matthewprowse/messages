# Runbook

How to run Konva in production: deploy, configure, scale, rotate keys, restore, read the alerts, and what the owner still has
to switch on. Product decisions live in `PLAN.md`; this file is only about operating what is built. The sync worker and the
AI worker are separate containers that meet in one Supabase database and never call each other. The web app runs on Vercel.

## What Runs Where

| Service | Where | Image | Health port |
| --- | --- | --- | --- |
| Web app (`apps/web`) | Vercel | none | none |
| Sync worker (`apps/worker`) | Container, one per shard | `apps/worker/Dockerfile` | `HEALTH_PORT` (8080 in the image) |
| AI worker (`apps/ai`) | Container, exactly one | `apps/ai/Dockerfile` | `HEALTH_PORT` (8080 in the image) |
| Instagram and iCloud Reminders | The AI image, started with `python -m ai instagram` or `icloud-reminders` | `apps/ai/Dockerfile` with `EXTRA_REQUIREMENTS` | none (run with the health check off) |
| LinkedIn helper (`apps/linkedin`) | Not in the worker image yet | build with `pnpm linkedin:build` | none |

After Confidential Space (stage 4, built at the first paying client) the same two images run on Confidential VMs; the image
digest is what the KMS policy trusts, so a deploy there also means changing the allowed digests (see Rotating And Releasing).

## Deploy

Images are built from the repo root and are never built or pushed from a laptop for production.

```
docker build -f apps/worker/Dockerfile -t konva-worker .
docker build -f apps/ai/Dockerfile -t konva-ai .
docker build -f apps/ai/Dockerfile --build-arg EXTRA_REQUIREMENTS=requirements-instagram.txt -t konva-ai-instagram .
```

CI (`.github/workflows/ci.yml`) builds both images on every pull request without pushing, so a broken lockfile or base image
pin shows up before a release. Base images are pinned by digest in the Dockerfiles; to move a pin, inspect the new tag
(`docker buildx imagetools inspect node:24-bookworm-slim`), change the digest in the Dockerfile, and rebuild.

Order for a release:

1. Apply new migrations first (`supabase/migrations`, append only). The workers warn and carry on when a table they use is
   missing, so a migration may land before or after the code, but never run code that needs a column that does not exist yet.
2. Deploy the web app (push to `main`, Vercel builds).
3. Roll the sync worker. A shard's lease means the old container must exit before the new one holds the lease: a new
   container waits up to 90 seconds for a lease a killed worker left behind, so a deploy is a gap of 10 to 90 seconds and
   every WhatsApp and IMAP link reconnects. Set the stop grace period to at least 20 seconds (the worker finishes in-flight
   sends for up to 10 seconds after SIGTERM).
4. Roll the AI worker the same way (it also holds a lease, named `ai`).
5. Watch the readiness endpoint and the `metrics` log lines for five minutes (see Alerts).

Run with a restart policy that restarts on exit (the lease makes crash restarts safe). `STOPSIGNAL` is SIGTERM in both images.
Start probes must allow 120 seconds before the first readiness success.

## Environment Variables

Each service documents its own variables, with where to find each value, in its example file. Copy the names, never the
values, into the host's secret store. No `.env` file is ever baked into an image or committed.

| Service | Variables |
| --- | --- |
| Web app | `apps/web/.env.example`, set in the Vercel project (Production and Preview) |
| Sync worker | `apps/worker/.env.example` |
| AI worker | `apps/ai/.env.example` |

Both containers also read these operational variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `HEALTH_PORT` | unset locally, `8080` in the images | Port of the health endpoint. Unset or `off` turns it off, so `pnpm worker` and `pnpm ai` can run side by side on a laptop. |
| `ERROR_TRACKER_DSN` | unset | A Sentry-compatible DSN (Sentry, GlitchTip). Unset: errors are only counted and logged. The payload is the error code, class, the place it was caught and stack frames. Never the message, a name or an address. |

Values that must match across services: `KEY_WRAPPING_KEY`, `KMS_KEY_NAME`, `ENCRYPT_CONTENT` and `ENCRYPT_ADDRESSES` (worker
and AI worker, and `NEXT_PUBLIC_ENCRYPT_CONTENT` in the web app), `ENCRYPTION_KEY` (until `credentials:reseal` reports none
left), `GRAPH_NOTIFY_SECRET` (worker and web), the Google, Microsoft and Zoom client ids and secrets (worker and web).
Both workers refuse to start in production (`NODE_ENV` or `APP_ENV` is `production` in the images) with either encryption
flag set to `false`.

## Health Endpoint

Both workers serve the same three read-only paths on `HEALTH_PORT`:

| Path | Meaning |
| --- | --- |
| `/healthz` | Liveness: the process answers. Restart if it stops answering. |
| `/readyz` | Readiness: 200 when the worker holds its lease and its main loop ticked in the last 120 seconds, else 503 with reasons. |
| `/metrics` | Counters in Prometheus text form (`konva_sends`, `konva_syncs`, `konva_ai_calls`, `konva_failures`, and `konva_ai_` prefixed on the AI worker). |

Reasons in a 503: `no_tick_yet` (still starting, or the first loop turn has not finished), `lease_not_held`, `tick_stale` (the
main loop is stuck). The port must be reachable by the supervisor only, never published to the internet.

## Logs And Counters

Both workers write one JSON object per line to stdout (errors to stderr), content free. Two kinds of line matter for ops:

- An error report: `{"level":"error","msg":"<place> failed","code":"...","cls":"...","where":"...","frames":"fn@file:line < ..."}`.
- A counter line once a minute when anything moved: `{"msg":"metrics","window_s":60,"sends{channel=gmail,outcome=ok}":3,"failures{code=ECONNRESET,where=reconcile}":1}`.
  Each value is the change in that minute, so a log pipeline sums them. Families: `sends`, `syncs`, `ai_calls` (AI worker), `jobs`
  (AI worker), `failures`.

Message text, names, addresses and tokens never appear in either. If one does, that is a bug: fix it and rotate nothing, but
tell the owner. Ship stdout to the host's log service (Cloud Logging on Google Cloud) and build alerts on the lines above.

## Scaling Shards

The sync worker splits by account: set `WORKER_SHARD_COUNT` (total) and a distinct `WORKER_SHARD_INDEX` (0 to count minus 1) on
each container. Shard 0 also runs the whole-table jobs (photos, logos, linkers, usage rollup, share jobs, key rotation, push,
account deletion). Rules:

1. Add workers as capacity needs it (see Cost By User Count in `PLAN.md`, which says when the next machine is due).
2. Changing the count reassigns most accounts. Update every worker's `WORKER_SHARD_COUNT` and restart them within a minute of
   each other. Expect every WhatsApp and IMAP link to reconnect once.
3. Each shard has its own lease (`shard-<index>`). `LEASE_TAKEN` on start means another container already runs that index.
4. The AI worker is not safe to run as several instances yet. Keep exactly one until drafts, triage and transcription claim
   their rows. Do not scale it by adding containers.

## Rotating And Releasing Keys

- **`KEY_WRAPPING_KEY` or the KMS key.** Never delete the old key before every row is rewrapped. With KMS: create a new key
  version, keep the old version enabled, run `pnpm --filter worker rewrap-keys` against production from an approved machine, check
  that nothing is left under the old version, then disable the old version. The old `KEY_WRAPPING_KEY` is deleted from every environment and from the
  backup copy only after that. Keep a copy of the current key in a password manager: losing it makes encrypted messages
  unreadable.
- **`ENCRYPTION_KEY` (old static key).** Run `pnpm --filter worker credentials:reseal`; when it reports 0 left the key can be removed
  from the worker, AI worker and web app.
- **Provider secrets** (Google, Microsoft, Zoom client secrets, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
  `GRAPH_NOTIFY_SECRET`, VAPID keys): change in the provider, update the host secret store for every service that holds it,
  roll the containers. Changing VAPID keys drops every browser's push subscription; people re-allow notifications.
- **Confidential Space.** Each release publishes the image digest and the commit it was built from. The KMS Decrypt policy
  allows only the expected digests, so shipping means adding the new digest first, rolling, then removing the old one.

## Restoring From Backup

Point in time recovery is a Supabase paid setting and is an open owner action (see below). Turn it on before the first paying
client and test one restore into a scratch project.

1. Stop both workers first, so nothing writes while you restore (a worker mid-send could send twice against restored rows).
2. In the Supabase dashboard (project `bbfahndgnmdlehicmphe` only, never the Marketing project), Database, Backups: restore
   to a point just before the damage. This replaces the database; changes after that point are lost.
3. Confirm migrations: the latest file in `supabase/migrations` must appear in the migration history.
4. Start the AI worker, then the sync worker. On start a worker fails any send or calendar write that was cut off, rather than
   repeat it (a person sees Failed and chooses to resend).
5. Storage objects (attachments) are not part of a database restore. Files missing afterwards are fetched again from the
   provider when opened.
6. A deleted user's keys are gone on purpose (crypto-shredding). A restore that brings back their `user_keys` row brings back
   their data: re-run any account deletion that finished after the restore point.

## Alerts

Alert on the worker log and health signals first. Every SQL check is read only and content free.

| Alert | Means | Do |
| --- | --- | --- |
| Readiness 503 `tick_stale` for 3 minutes | The main loop is stuck (a hung call, a database outage). | Check Supabase status, read the last `failures` lines, restart the container. Safe: the lease expires in 90 seconds. |
| Readiness 503 `lease_not_held` | The worker lost its lease and is exiting. | Normal during a deploy. If it repeats, two containers share one `WORKER_SHARD_INDEX`: fix the config. |
| Exit with `LEASE_TAKEN` on start | Another worker holds that shard. | Find the other container. Do not delete the lease row while it runs. |
| `LEASE_EXPIRED` in the log | Renewals failed for a whole lease lifetime (database unreachable). | Check Supabase; the worker already stopped itself. |
| `failures` rising, one `where` | A loop is failing; the `code` says how (`ECONNRESET`, `429`, Postgres codes). | Read the error report line for the frames. Provider 401 and 403 codes mean accounts need reconnecting. |
| `failures{where=unhandled_rejection}` or `uncaught_exception` | A bug. The worker exits on an uncaught exception and restarts. | Open the report in the tracker or the log, fix the frames' function. |
| `sends{outcome=failed}` rising | Replies are failing to send. | Check the provider status and `accounts.status`; a send cut off by a restart is failed on the next start, never repeated. |
| `ai_calls{outcome=failed}` rising | Gemini errors or the spend breaker. | Check the Gemini status page and quota; the spend breaker pauses calls when the budget is hit. |
| No `metrics` lines for 5 minutes from a running worker | Nothing is moving: no syncs, no loop turns. | Treat as `tick_stale`. |
| SQL: `outbox` rows `queued` older than 2 minutes | Nobody is claiming sends (worker down, or the account's shard has no worker). | Check that every shard index has a running container. |
| SQL: `drafts` `pending` older than 1 minute | The AI worker is down or stuck. | Check its readiness and lease. |
| SQL: `accounts.status = 'error'` count up | Connectors lost their sign-ins. | Look for a provider outage or a revoked app permission before asking people to reconnect. |
| SQL: `worker_leases.expires_at` in the past for a shard | That shard has no worker. | Start one. |
| SQL: failed rows by table and code, daily | A bad rollout shows here first. | Compare with the last deploy; roll back if it started then. |

## Owner Actions Still Open

These need the owner's accounts and cannot be done from code. Each is a dashboard or console step.

- **VAPID keys (web push).** Run `pnpm --filter worker vapid:generate`. Put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
  `VAPID_SUBJECT` in the worker's secrets and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the web app. Until set, the push sender stays off.
- **Gmail push (Cloud Pub/Sub).** Create the topic and a pull subscription, give `gmail-api-push@system.gserviceaccount.com` the
  Publisher role on the topic and the worker's service account the Subscriber role on the subscription, then set
  `GMAIL_PUBSUB_TOPIC` and `GMAIL_PUBSUB_SUBSCRIPTION` on the worker. Until set, Gmail is checked every
  `MAIL_SLOW_POLL_MS`.
- **Outlook push (Graph notification URL).** Set `GRAPH_NOTIFICATION_URL` (`<app origin>/api/graph/notify`) and the same
  long random `GRAPH_NOTIFY_SECRET` on the worker and the web app. Until set, Outlook is polled.
- **Meta webhook (Instagram).** In the Meta app, subscribe the callback `<app origin>/api/meta/webhook` with
  `META_WEBHOOK_VERIFY_TOKEN`, set `INSTAGRAM_APP_SECRET`, then set `INSTAGRAM_WEBHOOKS=true` on the Instagram process. Human
  Agent needs Meta's approval before `INSTAGRAM_HUMAN_AGENT` is turned on.
- **Google Picker.** In the Google Cloud project enable the Picker and Drive APIs, create the Web OAuth client and a Picker API
  key restricted to the app origin, list the `drive.file` scope on the consent screen, and set the three
  `NEXT_PUBLIC_GOOGLE_PICKER_*` variables (`apps/web/.env.example`).
- **Microsoft permissions.** In the Entra app add the delegated permissions for mail, calendar, Teams (`Chat.ReadWrite`,
  `OnlineMeetings.Read`) and OneDrive (`Files.Read`), plus the single-page redirect
  `<app origin>/attachments/onedrive-callback`. Teams transcripts need admin consent for some organisations
  (`docs/CONNECTOR-SETUP.md`).
- **Supabase Auth.** Turn on TOTP under Authentication, Multi-Factor, and turn on leaked password protection under
  Authentication, Providers, Email (the advisor reports it as off). Also check that Confirm Email is on.
- **Backups.** Turn on point in time recovery, and two-factor sign-in on Google, Vercel and Supabase.
- **Error tracker.** Create a project in Sentry or GlitchTip, and set `ERROR_TRACKER_DSN` on both workers. Optional; without it
  the log carries every report.
- **Confidential Space.** Stage 4 of the privacy plan, built at the first paying client. These Dockerfiles are its starting point.
