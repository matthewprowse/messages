# Runbook

How to run Konva in production: deploy, configure, scale, rotate keys, restore, read the alerts, and what the owner still has
to switch on. Product decisions live in `PLAN.md`; this file is only about operating what is built. The sync worker and the
AI worker are separate containers that meet in one Supabase database and never call each other. The web app runs on Vercel.

## What Runs Where

| Service | Where | Image | Health port |
| --- | --- | --- | --- |
| Web app (`apps/web`) | Vercel project `konva` (team `prowse`), functions in `dub1` | none | none |
| Sync worker (`apps/worker`) | VM `konva-workers` (laptop until launch), container, one per shard | `apps/worker/Dockerfile` | `HEALTH_PORT` (8080 in the image) |
| AI worker (`apps/ai`) | VM `konva-workers` (laptop until launch), container, exactly one | `apps/ai/Dockerfile` | `HEALTH_PORT` (8080 in the image) |
| Instagram and iCloud Reminders | The AI image, started with `python -m ai instagram` or `icloud-reminders` | `apps/ai/Dockerfile` with `EXTRA_REQUIREMENTS` | none (run with the health check off) |
| LinkedIn helper (`apps/linkedin`) | Inside the worker image at `/usr/local/bin/konva-linkedin` (`LINKEDIN_HELPER`) | built in the worker Dockerfile | none |

After Confidential Space (stage 4, built at the first paying client) the same two images run on Confidential VMs; the image
digest is what the KMS policy trusts, so a deploy there also means changing the allowed digests (see Rotating And Releasing).

## Deploy

Images are built from the repo root and are never built or pushed from a laptop for production. Today the production
images are built on the VM from a pushed commit that passed CI (see Production VM). Once a registry is set up, CI builds
them from a release tag and the VM pulls them by digest instead (see Images Built In CI).

```
docker build -f apps/worker/Dockerfile -t konva-worker .
docker build -f apps/ai/Dockerfile -t konva-ai .
docker build -f apps/ai/Dockerfile --build-arg EXTRA_REQUIREMENTS=requirements-instagram.txt -t konva-ai-instagram .
```

CI (`.github/workflows/ci.yml`) builds both images on every pull request without pushing, so a broken lockfile or base image
pin shows up before a release. Base images are pinned by digest in the Dockerfiles; to move a pin, inspect the new tag
(`docker buildx imagetools inspect node:24-bookworm-slim`), change the digest in the Dockerfile, and rebuild. CI runs with a
read only token and every third-party action pinned by commit (the comment in `ci.yml` says how to move one).

Python dependencies are installed with `pip --require-hashes` from `apps/ai/requirements*.lock.txt` once those exist. After
moving any pin in `apps/ai/requirements*.txt`, run `deploy/lock-ai-requirements.sh` (needs Docker on the laptop), review the
diff and commit the locks with the pin. Until the locks are committed the image installs from the plain pins.

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

## Web App On Vercel

The Vercel project `konva` builds `apps/web` (Node 24) on every push to `main`. Supabase is in AWS Ireland, so functions run
in Dublin (`dub1`). Vercel Authentication guards every address except custom domains, so the `*.vercel.app` address asks
for a Vercel sign-in; use the custom domain on the phone.

1. Push the env: `APP_URL=https://<domain> deploy/push-web-env.sh` copies `apps/web/.env.local` into Production (values
   are never printed). Lines pointing at `localhost` are skipped, and the local KMS key file goes up as
   `GOOGLE_APPLICATION_CREDENTIALS_JSON`. `APP_URL` is required: production refuses every browser request without it
   (`apps/web/lib/server/request.ts`), and the script stops before pushing anything unless it is a live `https://` origin
   (no path, not localhost). A value given on the command line wins over the file's. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   and `GRAPH_NOTIFY_SECRET` there too once they exist. Vercel previews do not use `APP_URL`: each takes its own address
   as its origin (`VERCEL_URL` or `VERCEL_BRANCH_URL`, set by Vercel), so OAuth callbacks only work on a preview whose
   address is registered with the provider.
2. Add the domain in the Vercel project (Settings, Domains) and the DNS record it asks for.
3. Supabase, Authentication, URL Configuration: Site URL `https://<domain>`, and `https://<domain>/**` in Redirect URLs.
4. Google, Microsoft and Zoom OAuth clients: add the same callback paths the local `http://localhost:3000` ones use, on
   `https://<domain>`. Google: also publish the consent screen (Testing mode expires Gmail sign-ins after 7 days).
5. Redeploy (push, or Redeploy in Vercel): env changes apply to the next build.
6. On the iPhone: open the domain in Safari, Share, Add to Home Screen. Web push only works from the home screen app.

Sign-up is limited to approved emails (`supabase/migrations/20261124150100_approved_signups.sql`): Supabase Auth refuses a
new user unless the email has a waitlist row approved on `/admin`, or an open team invite (not accepted, not expired).
Existing accounts sign in as before. The rule also covers users added by hand (dashboard Add User, `auth.admin.createUser`),
so approve the email on the waitlist, or invite it to a team, before adding someone yourself.

## Production VM

Not created yet: until launch the workers run on the owner's laptop (`pnpm worker`, `pnpm ai`), and the live site only gets
new mail and drafts while they run (docs/PLAN.md, "Hosting For Daily Use"). Once the VM exists, stop the laptop workers.

One Compute Engine VM, `konva-workers` (e2-small or e2-medium, see PLAN.md; `africa-south1-a`, project `messages-keys`), runs the workers with Docker
Compose (`deploy/compose.yaml`). Its service account `konva-workers@messages-keys.iam.gserviceaccount.com` may only encrypt
and decrypt with `user-data-keys`, write logs and write host metrics, and the workers reach KMS through the metadata server,
so no key file is on the VM.

The VM has no public address. It sits on its own network `konva` (subnet `konva-workers`, 10.10.0.0/24), reaches the internet
through Cloud NAT (`konva-router`, `konva-nat`) and Google APIs through Private Google Access. The only ingress rule,
`konva-allow-iap-ssh`, opens port 22 to Identity-Aware Proxy (35.235.240.0/20), so every SSH goes through IAP
(`--tunnel-through-iap`, which the deploy scripts pass) and OS Login with two-step verification. To SSH you need
`roles/iap.tunnelResourceAccessor` and `roles/compute.osAdminLogin` on the project, and two-step verification on your Google
account.

| Step | Command (from the repo root on the laptop) |
| --- | --- |
| Create the VM (once; safe to repeat) | `deploy/create-vm.sh` |
| Copy the env files (after any change to them) | `deploy/push-env.sh` (reads `apps/worker/.env` and `apps/ai/.env`; `WORKER_ENV`, `AI_ENV` to use others) |
| Release | `deploy/release.sh [git ref]` (default `origin/main`: push first, the working tree never ships; CI must have passed on it) |
| Optional connectors | on the VM, `echo icloud-reminders,instagram \| sudo tee /opt/konva/profiles`, then release |
| Shell | `gcloud compute ssh konva-workers --zone africa-south1-a --project messages-keys --tunnel-through-iap` |
| Logs | Cloud Logging, log name `konva_containers` (see Logs And Counters), or on the VM: `sudo docker compose -f /opt/konva/src/deploy/compose.yaml logs -f --tail 100` |
| Roll back | `deploy/release.sh <previous commit>` |

`release.sh` first checks on GitHub (`gh api`, so `gh auth login` once) that every CI job (`typescript`, `python`, `go`,
`docker`) passed on the commit, and stops if it cannot tell. `REQUIRE_SIGNED_TAG=1` also requires the ref to be a tag with a
signature `git verify-tag` accepts. `RELEASE_WITHOUT_CI=1` skips the CI check for an emergency while GitHub is down. It then
copies the commit to `/opt/konva/src` (the previous one stays at `/opt/konva/src.old`, and the commit is in `RELEASE`),
builds the images there (or pulls them, see Images Built In CI), then rolls the sync worker and the AI worker one at a time,
waiting up to 5 minutes for each to report ready. Containers restart on failure and after a reboot.

`push-env.sh` writes one env file per service (`worker.env`, `ai.env`, `instagram.env`, `icloud-reminders.env`), each holding
only the variables on that service's allow-list in the script. It names, never prints, any variable it leaves out: when a
service starts reading a new variable, add it to that list. `KMS_ACCESS_TOKEN` and `GOOGLE_APPLICATION_CREDENTIALS*` are never
copied. The files go over SSH's stdin straight into `/opt/konva/env` (root only, mode 0600). The env files' `ENCRYPT_*` must not
be `false`; `push-env.sh` refuses, because the workers would not start.

How the VM is hardened (`deploy/compose.yaml`, `deploy/vm-startup.sh`):

- Every container drops all Linux capabilities, cannot gain privileges, has a read only root filesystem with a 256 MB `/tmp`,
  and has a memory and process limit.
- Only the two compose bridges (`konva-core` for the workers, `konva-conn` for the connectors) may reach the metadata server,
  which hands out the KMS token. Image builds and any other container are refused by the `KONVA-METADATA` iptables chain,
  which the `konva-metadata-guard` unit puts back each time Docker starts. Check it after a change:
  `sudo docker run --rm debian:12-slim sh -c 'apt-get -qq update >/dev/null && apt-get -qq install -y curl >/dev/null && curl -m 3 -sH "Metadata-Flavor: Google" http://169.254.169.254/'`
  and the same from a build step, which runs on Docker's default bridge too and must be refused the same way:
  `printf 'FROM debian:12-slim\nRUN apt-get -qq update >/dev/null && apt-get -qq install -y curl >/dev/null && curl -m 3 -sH "Metadata-Flavor: Google" http://169.254.169.254/ && exit 1 || true\n' | sudo docker build -q -f - .`
  (the build must finish, which it only does when curl failed; a `--network=host` build would bypass the guard, so never pass that).
  must fail, while the workers still unwrap keys.
- The connectors still reach the metadata server, because they open sealed sign-ins with KMS. Taking that away needs a
  separate identity for them (their own VM and service account).

### Images Built In CI

`.github/workflows/release-images.yml` builds the four images (`konva-worker`, `konva-ai`, `konva-ai-instagram`,
`konva-ai-icloud-reminders`) on every `v*` tag and records each digest in the run summary and a `digest-*` artifact. It
pushes only once a registry is set up. To switch it on (once):

1. Create the registry: `gcloud artifacts repositories create konva --repository-format docker --location africa-south1 --project messages-keys`.
2. Create a pusher service account with `roles/artifactregistry.writer` on that repository only, and a Workload Identity
   pool and GitHub provider limited to this repository (attribute condition on `assertion.repository` and
   `assertion.ref_type == 'tag'`); give the repository's principal `roles/iam.workloadIdentityUser` on the pusher.
3. In GitHub, Settings, Variables (not secrets, none of these is secret): `IMAGE_REGISTRY` =
   `africa-south1-docker.pkg.dev/messages-keys/konva`, `GCP_WORKLOAD_IDENTITY_PROVIDER` = the provider's full name,
   `GCP_IMAGE_PUSHER` = the pusher's email.
4. Let the VM pull: give `konva-workers@messages-keys.iam.gserviceaccount.com` `roles/artifactregistry.reader` on the
   repository, and on the VM run `sudo gcloud auth configure-docker africa-south1-docker.pkg.dev`.
5. Release with `REGISTRY=africa-south1-docker.pkg.dev/messages-keys/konva deploy/release.sh vX.Y.Z`. It looks up each
   image's digest for the tag and the VM pulls exactly those, so nothing is built on the VM. Turn on immutable tags on the
   repository so a tag cannot be pushed twice.

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
| `HEALTH_HOST` | `127.0.0.1` | Address the health endpoint listens on. Loopback is enough for the image's own health check; set `0.0.0.0` only when something outside the container (a load balancer, a scraper) must reach it. |
| `ERROR_TRACKER_DSN` | unset | A Sentry-compatible DSN (Sentry, GlitchTip). Unset: errors are only counted and logged. The payload is the error code, class, the place it was caught and stack frames. Never the message, a name or an address. |

Values that must match across services: `KEY_WRAPPING_KEY`, `KMS_KEY_NAME`, `ENCRYPT_CONTENT` and `ENCRYPT_ADDRESSES` (worker
and AI worker, and `NEXT_PUBLIC_ENCRYPT_CONTENT` in the web app), `SEAL_BOUND_FIELDS` and `REQUIRE_BOUND_FIELDS` (worker and AI
worker, and `NEXT_PUBLIC_SEAL_BOUND_FIELDS` in the web app; see Binding Values To Their Place), `ENCRYPTION_KEY` (until `credentials:reseal` reports none
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
tell the owner.

On the VM the Google Cloud Ops Agent (installed by `deploy/vm-startup.sh`) ships every container's lines to Cloud Logging under
the log name `konva_containers`. Each line's own fields are in `jsonPayload` (`jsonPayload.msg`, `jsonPayload.code`, the
counters), `jsonPayload.attrs.tag` is the container (`konva-worker-1`, `konva-ai-1`, ...), and `level` sets the severity. Check
once after the first boot that a worker line arrives parsed this way; if `jsonPayload.log` is still a string, change the
`worker_line` processor's `field` in `vm-startup.sh`.

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
- **`ENCRYPTION_KEY` (old static key).** Nothing is sealed with it any more: sign-ins, the OAuth cookies and the sign-in
  handoffs (`icloud_setups`, `instagram_sign_ins.code`) all use the user's own key. It only reads older `"v1:"` values. Retire it
  with `KEY_WRAPPING_KEY`, below.
- **Provider secrets** (Google, Microsoft, Zoom client secrets, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
  `GRAPH_NOTIFY_SECRET`, VAPID keys): change in the provider, update the host secret store for every service that holds it,
  roll the containers. Changing VAPID keys drops every browser's push subscription; people re-allow notifications.
- **Confidential Space.** Each release publishes the image digest and the commit it was built from. The KMS Decrypt policy
  allows only the expected digests, so shipping means adding the new digest first, rolling, then removing the old one.

### Retiring The Static Keys

`KEY_WRAPPING_KEY` (the old `local:v1` wrapper) and `ENCRYPTION_KEY` (the old `"v1:"` sealing key) can be removed once nothing
stored needs them. Every service starts and runs without them; a row that still needed one fails with the code
`legacy_wrapper_missing` or `legacy_key_missing` (`LegacyKeyMissing` in the AI worker's logs) rather than anything worse. In order:

1. Apply `supabase/migrations/20261125130000_user_key_rotation.sql`. Readers select whole `user_keys` rows, so the code works
   before and after it, but the readiness counts and the re-key job need it.
2. Release the AI worker (and its connectors) first, then the web app. The per-user handoffs are read by both sides; the AI worker
   answers an iCloud setup in the format the web app wrote it, so this order never breaks a sign-in in flight.
3. `pnpm --filter worker keys:readiness`: what still needs each key, and the command that clears it. Read-only, no KMS calls.
4. `pnpm --filter worker rewrap-keys`, then `--apply` (needs `KMS_KEY_NAME` and `KEY_WRAPPING_KEY`).
5. `pnpm --filter worker credentials:reseal`, then `--apply`, at a quiet time (each resealed sign-in restarts its connector once).
6. Wait an hour after step 2: sign-in handoffs from before it are deleted within that (`KEEP_S` in
   `apps/ai/ai/connectors/icloud_reminders/setup.py`, the Instagram code sweep).
7. `pnpm --filter worker keys:readiness` again. Exit code 0 means both keys can go.
8. Remove both everywhere: Vercel (`vercel env rm KEY_WRAPPING_KEY production`, the same for `ENCRYPTION_KEY`, then redeploy),
   the workers' secret store (take them off the lists in `deploy/push-env.sh` and run it, then roll the containers), and every
   laptop `.env`. A database backup from before step 4 still needs `KEY_WRAPPING_KEY` to be read: keep one offline copy (password
   manager) until the oldest such backup has aged out of point in time recovery, then destroy it.
9. Rotate every user's data key (below): anyone who ever held `KEY_WRAPPING_KEY` and a copy of `user_keys` holds every data key
   until then.

### Rotating A User's Data Key

`pnpm --filter worker keys:rekey` (`apps/worker/src/rekey`, the order in `plan.ts`) gives a user a new data key and moves
everything sealed under the old one: every text column of every table with their `user_id` (JSON and arrays included), their
sign-ins and WhatsApp session, their handoffs, and every sealed file under their folder in the `attachments`, `avatars` and
`brief-audio` buckets. Their blind indexes do not change: the index key they were made with is kept (wrapped as
`user_index_keys:<user id>`), so no contact, thread or rule has to be matched again. Team keys rotate on their own (`share/rotate.ts`).

1. Run it only after the release with the rotation-aware readers has been out a day, so no browser still runs an older bundle.
2. `pnpm --filter worker keys:rekey --user <id>` (or `--all`): the dry run. It says what is due and counts, per table and bucket,
   what would move. Writes nothing.
3. `pnpm --filter worker keys:rekey --all --apply --follow`: prepares the new key, switches to it 15 minutes later (every
   reader's key cache has turned over by then), re-seals page by page, and retires the old key once a pass that began at least
   30 minutes after the switch found nothing to move. Stop it any time and run the same command again: it resumes from
   `user_key_rotations.cursor`. Without `--follow` each run does one step and says when the next is due.
4. A pass that finds values no key opens reports them per table as unreadable and does not retire. Those values were unreadable
   before the job too. Look at which tables they are in; `--accept-unreadable` retires anyway. A table that fails (a migration not
   applied yet) also stops the retiring until it is fixed.
5. `pnpm --filter worker keys:readiness` lists rotations not finished.

The re-seal writes through `rekey_write`, which keeps triggers quiet (`session_replication_role = replica` where the database
allows it, otherwise the address index and share flags), so nothing looks edited or is shared again. If the database refuses the
replica role, `updated_at` moves on re-sealed rows and an open note may show its "changed elsewhere" notice once; the text is the
same. Old database backups still hold the old wrapped key, which KMS still opens: a rotation protects what is stored from now on.

### Binding Values To Their Place

Sealed values used to name only their kind of text (`"e1:"`, additional data `"body"`), so anyone with database write could
copy a message body into an outbox row and the worker would send it (security audit H4). New values are `"e2:"`: bound to
their owner (user, or workspace for `"t2:"`), their kind, `<table>.<column>` and, for the rows that drive an action, the row
(`packages/crypto/src/bound.ts`, `places.ts`). Files are `"e2b:"`, bound to `<bucket>/<path>`. The workers send, and write to
calendars and task lists, only what was sealed for that very row and column (`openBound`); they refuse plain text there while
encryption is on, and after step 6 the legacy format too. Three switches, all off unless `"true"`:

| Variable | Where | What it does |
| --- | --- | --- |
| `SEAL_BOUND_FIELDS` | worker and AI worker | New values and files are written bound. `keys:rekey` and `fields:bind` bind what is stored. |
| `NEXT_PUBLIC_SEAL_BOUND_FIELDS` | web app (Production and Preview) | The same for what the browser seals: outbox rows, files, calendar and task changes. |
| `REQUIRE_BOUND_FIELDS` | worker and AI worker | Sends, calendar and task writes refuse legacy `"e1:"`/`"e1b:"` values (code `legacy_value`). |

A refused row fails with "Nothing was sent: this message could not be verified" (calendar and task changes say the same in
their words); the log has the code (`sealed_elsewhere`, `plaintext_refused`, `legacy_value`, `team_value_refused`). In order,
fitted into the order above (migrations, release workers then web, rewrap, reseal credentials, readiness, remove the static
keys, rekey):

1. Apply `20261126100000_bound_values.sql` and `20261126100100_rekey_bound_values.sql` with the other migrations (not
   `20261126100900`). They only widen what the database accepts, so they are safe before any release.
2. Release the workers, then the web app, with every switch above off. They read both formats; nothing writes `"e2:"` yet.
3. Wait a day, so no browser still runs a bundle that cannot read `"e2:"` (the rule `keys:rekey` already follows).
4. Turn on `SEAL_BOUND_FIELDS` on the workers (`deploy/push-env.sh`, then roll the containers), then
   `NEXT_PUBLIC_SEAL_BOUND_FIELDS` on Vercel and redeploy. Workers first: they must read what the app starts to write.
5. Bind what is stored: `pnpm --filter worker fields:bind --all` (dry run: counts per table and bucket), then `--apply` at a
   quiet time. It is idempotent and safe beside a rotation; run it again until the dry run counts nothing to bind. A rotation
   with `SEAL_BOUND_FIELDS` on does the same (`keys:rekey` binds while it re-seals), so if the rotation of step 9 of Retiring
   The Static Keys is due anyway, it can stand in for this step: a rotation only retires the old key once nothing is left to bind.
6. Turn on `REQUIRE_BOUND_FIELDS` on the workers and roll them. From now on a legacy value in an outbox, calendar or task row
   is refused, so the audit's copy attack needs a value sealed for that row, which only the user's key can make.
7. Optional, last: apply `20261126100900_require_bound_values.sql`. It adds NOT VALID check constraints so queued outbox,
   outbox file, calendar and task rows can only be inserted with bound values. It refuses to apply (and changes nothing)
   until the outbox holds bound rows from the last week and no queued row is unbound. Never apply it to a database that local
   development uses with encryption off: those writes are plain and would be refused.

Still not bound to a row: content written by the database's ingest functions (messages, threads, contacts), which make
their own ids, so those values are bound to owner, kind and column only; values the database copies (a message's subject
into its thread) keep the place they were sealed for. Team values are still written `"t1:"` (read either way). The search
index cached in the browser and `message_embeddings.embedding_data` stay in the legacy file format.

### KMS Without A Key File

The web app on Vercel reaches Cloud KMS with Workload Identity Federation instead of a stored service account key: each function
gets a short-lived OIDC token from Vercel, Google STS exchanges it, and it impersonates the key service account
(`packages/crypto/src/google-token.ts`). Once set, the JSON key is no longer used. One time, in the Google Cloud project that holds
the KMS key (`messages-keys`), with `gcloud`:

1. Vercel: project `konva`, Settings, Security (OIDC Federation): turn it on with the **Team** issuer. The issuer is
   `https://oidc.vercel.com/<team slug>`, the audience `https://vercel.com/<team slug>`, and the subject of a production function
   `owner:<team slug>:project:konva:environment:production`.
2. Turn on the APIs: `gcloud services enable sts.googleapis.com iamcredentials.googleapis.com --project messages-keys`.
3. A pool and a provider that trust only that subject:
   `gcloud iam workload-identity-pools create vercel --location=global --project messages-keys`, then
   `gcloud iam workload-identity-pools providers create-oidc konva --location=global --workload-identity-pool=vercel --project messages-keys --issuer-uri=https://oidc.vercel.com/<team slug> --allowed-audiences=https://vercel.com/<team slug> --attribute-mapping=google.subject=assertion.sub --attribute-condition="assertion.sub == 'owner:<team slug>:project:konva:environment:production'"`.
4. Let that subject impersonate the service account that already has Cloud KMS Encrypter/Decrypter on `user-data-keys`:
   `gcloud iam service-accounts add-iam-policy-binding <account email> --project messages-keys --role=roles/iam.workloadIdentityUser --member="principal://iam.googleapis.com/projects/<project number>/locations/global/workloadIdentityPools/vercel/subject/owner:<team slug>:project:konva:environment:production"`.
5. In `apps/web/.env.local` set `GCP_WORKLOAD_IDENTITY_PROVIDER=projects/<project number>/locations/global/workloadIdentityPools/vercel/providers/konva`
   and `GCP_SERVICE_ACCOUNT_EMAIL=<account email>`, and run `APP_URL=https://<domain> deploy/push-web-env.sh` (it stops pushing
   the key file once the provider is set). Redeploy, sign in, and check messages open (`/api/keys`). A failure shows in the
   Vercel logs as a code: `wif_no_oidc_token` (step 1), `sts_400` or `sts_403` (step 3), `iam_403` (step 4).
6. Then delete the JSON: `vercel env rm GOOGLE_APPLICATION_CREDENTIALS_JSON production`, delete the key in Google Cloud
   (`gcloud iam service-accounts keys list --iam-account <account email>`, then `keys delete <id>`), and remove the local key file
   if the laptop no longer needs it (local development can use `vercel env pull`, which writes a `VERCEL_OIDC_TOKEN` for 12 hours).

Previews get no KMS access under this condition, by design. The workers are unchanged: on the VM they use the metadata server.

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

## If The KMS Key Is Lost

Every user's data key is wrapped by one Cloud KMS key (`projects/messages-keys/locations/africa-south1/keyRings/messages/
cryptoKeys/user-data-keys`). KMS keys cannot be exported. Destroying that key's version, the key ring or the `messages-keys`
project makes every user's messages, every Supabase backup and every attachment unreadable, for good: there is no second
copy anywhere, by design (the wrapped keys in `user_keys` are useless without it). Treat the project as the most
important thing Konva owns.

Protections, each an owner action in the console or with gcloud:

1. A lien, so the project cannot be deleted without first removing it:
   `gcloud alpha resource-manager liens create --project messages-keys --restrictions=resourcemanager.projects.delete --reason="holds the key that wraps every user's data key" --origin=konva`
2. The longest scheduled-destruction window on the key, so a destroyed version can be restored for 120 days (the maximum)
   instead of 30: `gcloud kms keys update user-data-keys --keyring messages --location africa-south1 --project messages-keys --destroy-scheduled-duration=120d`
   (new versions only; check with `gcloud kms keys describe`).
3. The alert under Alerts on `DestroyCryptoKeyVersion` and `SetIamPolicy` for the key, so a destruction or a new decrypter is
   seen the hour it happens, inside the restore window.
4. Owner on `messages-keys` for as few accounts as possible, each with two-step verification. Nobody needs Owner day to day:
   the VM's service account holds Encrypter/Decrypter only.

If a version is destroyed by mistake: restore it within the window (`gcloud kms keys versions restore`), then
`gcloud kms keys versions enable`. If the project is deleted: it can be restored for 30 days from the console (IAM and
Admin, Manage Resources, Deleted). After those windows the data is gone and the honest step is to tell every user.

## Alerts

Alert on the worker log and health signals first. Every SQL check is read only and content free.

Policies to create in Cloud Monitoring (owner action, once the VM runs), each emailing the owner:

- Log-based alert: `logName:"konva_containers" AND severity>=ERROR`, more than 5 in 10 minutes.
- Log-based alert: `logName:"konva_containers" AND (jsonPayload.code="LEASE_TAKEN" OR jsonPayload.code="LEASE_EXPIRED")`.
- Metric absence: no `konva_containers` entries with `jsonPayload.msg="metrics"` for 10 minutes (the workers stopped moving).
- Log-based alert on the audit log: `(protoPayload.methodName:"compute.firewalls" OR protoPayload.methodName:"setIamPolicy")`
  in project `messages-keys` (someone opened a port or changed who may decrypt).
- Log-based alert on the audit log: `protoPayload.methodName:"DestroyCryptoKeyVersion" OR protoPayload.methodName:"UpdateCryptoKey"`
  in project `messages-keys` (someone scheduled the key that wraps every user's data key for destruction, or changed it).
- Host: memory above 90% for 10 minutes on `konva-workers` (Ops Agent metric `agent.googleapis.com/memory/percent_used`).

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
- **Workers VM network.** In project `messages-keys`, delete the default network's open rules once nothing uses them:
  `gcloud compute firewall-rules delete default-allow-ssh default-allow-rdp --project messages-keys` (check
  `gcloud compute firewall-rules list --project messages-keys` first). Give your account `roles/iap.tunnelResourceAccessor`
  and `roles/compute.osAdminLogin`, and turn on two-step verification on it.
- **Images in CI.** Set up the registry (Images Built In CI). The hash locks exist (`apps/ai/requirements*.lock.txt`, written
  with uv on 5 November 2026; run `deploy/lock-ai-requirements.sh` after moving any pin). Create the alert policies under Alerts.
- **Enable Compute Engine first.** The API is off in `messages-keys` (checked 4 November 2026), so `deploy/create-vm.sh` cannot
  run yet: `gcloud services enable compute.googleapis.com --project messages-keys`, then the VM steps under Production VM. Until
  the VM runs, the workers run on the owner's laptop, which holds the service role key and the KMS credential.
- **Vercel: remove the retired keys and the key file.** `vercel env rm KEY_WRAPPING_KEY production`, `vercel env rm ENCRYPTION_KEY
  production`, and the same for `preview` (they were set for both). `keys:readiness` reported nothing needs either. Once
  Workload Identity Federation is set (KMS Without A Key File), `vercel env rm GOOGLE_APPLICATION_CREDENTIALS_JSON production`
  and delete the service account key in IAM (`gcloud iam service-accounts keys delete`). `deploy/push-web-env.sh` now sets
  everything Production only and sensitive; variables made before it were created readable and for Preview too, so re-run it
  once and delete the Preview copies by hand.
- **Protect `main`.** Nothing stops a direct push today, and `deploy/release.sh` checks CI on the commit but not review:
  `gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input - <<'JSON'`
  `{"required_status_checks":{"strict":true,"contexts":["typescript","python","go","docker"]},"enforce_admins":true,"required_pull_request_reviews":null,"restrictions":null,"allow_force_pushes":false,"allow_deletions":false}`
  `JSON` (owner and repo from `git remote -v`).
- **Delete the LinkedIn captures.** `captures/linkedin/*.har` (400 MB, 0644) hold a password sign-in and a messaging session:
  `rm -P captures/linkedin/*.har && chmod 700 captures`. They were only ever for building the bridge.
- **KMS key protections.** The lien, the destruction window and the alert under If The KMS Key Is Lost.
