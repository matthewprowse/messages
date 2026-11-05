# Security Assessment, 4 November 2026

A second pass, one day after `docs/security-audit-2026-11-03.md`. Six parallel reviewers (encryption and keys, web
server, database, sync worker, AI worker, infrastructure and dependencies) re-checked yesterday's fixes adversarially in
the working tree and hunted for what that audit missed. Unlike yesterday, this pass also checked the live environment,
read-only: the Vercel project's variable names and settings, Google Cloud IAM and KMS, Supabase Auth's public settings,
counts in the production database through the worker's own readiness script, the GitHub branch rules and the processes
running on the owner's laptop. Nothing was changed, sent or deployed. Dependency advisories were checked against the
public databases.

The question behind it: what is still unbuilt, what is vulnerable today, where are the weak points, and what has to be
true before Konva can be put in front of a partner and paying clients with confidence.

## The Short Answer

The application code is in good shape. Tenant isolation holds on all 97 tables, every outbound request the workers make
to a sender-controlled address is pinned and capped, untrusted text is fenced before it reaches the model, the model can
never send anything, and no secret has ever been committed. Every High and Medium finding from yesterday is fixed in code, and the fixes were confirmed by reading and, where
possible, probing them; the exceptions are listed under "Not In Effect" below.

The gap is between the code and what is actually running. Four things make today's deployment weaker than the code and
the public security page suggest:

1. **Production runs on the owner's laptop.** The sync worker, the AI worker, the Instagram connector and the iCloud
   Reminders connector are all running on this MacBook (checked with `ps`). The hardened VM in `deploy/` does not exist:
   the Compute Engine API is not enabled in the `messages-keys` project. The laptop holds the Supabase service-role key,
   a never-expiring Google service-account key with KMS decrypt on every user's data key, every connected account's
   credentials in memory, and 400 MB of LinkedIn session captures on disk. `docs/RUNBOOK.md` says "laptop until launch",
   so this is known, but it is the single largest risk and the first thing a partner would ask about.
2. **The retired static keys are still deployed.** `keys:readiness` reports that nothing in the database needs
   `KEY_WRAPPING_KEY` or `ENCRYPTION_KEY` any more, yet both are in Vercel (readable, and exposed to Preview deployments as
   well as Production), together with `GOOGLE_APPLICATION_CREDENTIALS_JSON`. No Workload Identity Federation pool exists,
   so that service-account key is the only KMS credential. `deploy/push-web-env.sh` has no allow-list and would push
   them again.
3. **Ciphertext binding is built but switched off.** The `e2:` format that stops a copied ciphertext being replayed into
   an outbox row is correct in both languages and tested with shared vectors, but `SEAL_BOUND_FIELDS`,
   `NEXT_PUBLIC_SEAL_BOUND_FIELDS` and `REQUIRE_BOUND_FIELDS` default off, are not set in Vercel, `fields:bind` has not
   run and the constraint migration `20261126100900` is not applied (its functions are absent in production). The
   insider and database-write attack from yesterday's H4 still works today.
4. **Two medium cross-tenant and phishing paths are new.** Any signed-in user can receive every other user's deleted
   calendar rows through Realtime, and a forged enquiry email can drive the lead-capture automation and the pre-draft
   queue even when triage has flagged it as suspicious.

None of these needs new design work. Items 2 to 4 are a day or two of work. Item 1 is the owner creating the VM with the
scripts that already exist.

## What Is Running Today (Runtime Facts)

| Check | Result |
| --- | --- |
| Workers | `pnpm worker`, `python3 -m ai`, `python3 -m ai instagram`, `python3 -m ai icloud-reminders` running on the laptop for 47 minutes at the time of the check |
| Google Cloud project `messages-keys` | Compute Engine API disabled, so no VM. One service account `konva-keys@`, KMS Encrypter/Decrypter on `user-data-keys`. One user-managed key, created 27 October 2026, expires 9999. No workload identity pools. |
| Vercel project `konva` | 15 variables. `KEY_WRAPPING_KEY`, `ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_APPLICATION_CREDENTIALS_JSON` and `GOOGLE_WEB_CLIENT_SECRET` are flagged by Vercel as readable secrets (not marked Sensitive). All but `APP_URL` are exposed to Preview as well as Production. No `SEAL_BOUND_FIELDS`, `NEXT_PUBLIC_SEAL_BOUND_FIELDS`, `REQUIRE_BOUND_FIELDS`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. One team member. SSO protection on for non-custom domains. |
| Supabase Auth (public settings) | Sign-up enabled at the Auth layer (the database trigger is the gate). Email confirmation required. Email is the only provider. TOTP state not visible without the dashboard. |
| Production database | `user_key_rotations`, `thread_assignment_log`, `icloud_setups`, `push_subscriptions` exist, so `20261124*` and `20261125*` are applied. `is_bound_value` and `all_bound_values` are absent, so `20261126100900` is not. `keys:readiness` exits 0: zero rows need either static key, no unfinished rotations. |
| GitHub | Repository private. `main` has no branch protection, so `release.sh`'s "green CI on this commit" gate is the only check, and it accepts any check-run named `typescript`, `python`, `go` or `docker` from any app. |
| Laptop | Env files are 0600. `captures/linkedin/` holds three HAR files (400 MB, 0644) including a password sign-in and a messaging session. `apps/ai/requirements.lock.txt` does not exist. |
| Dependencies | npm: fflate 0.8.2 (moderate, unzip only, Konva only writes zips), minimatch and deepmerge through the shadcn CLI (dev only). Python: `cryptography` 46.0.7 has three advisories in code paths Konva does not use (x509, PKCS#7, bundled OpenSSL DoS); `uv.lock` already resolves 50.0.2 but nothing installs from it. Every transitive Python dependency of the connectors is unpinned. Baileys pinned and hash-checked. Go module pinned, never scanned. |

## Yesterday's Findings: What Holds

Verified in the working tree by the reviewers, with file and line evidence in their reports (summarised):

- **H2** WhatsApp media: sender URL ignored, `directPath` validated, host forced to `*.whatsapp.net`, streamed with a byte
  cap. Probed: `//evil.com/x` stays on `mmg.whatsapp.net`.
- **H3** Automations never add an identifier to a contact matched on a different one; partial matches become a new Lead
  plus a merge suggestion; VIP and non-Lead contacts are untouched.
- **H4** AAD is byte-identical in TypeScript and Python (57 and 63 tests pass on shared vectors). Writers and strict
  readers agree on table, column and row. Plaintext is refused in action columns. See "switched off" above.
- **H5** Names, calendar text, guests, join links, outgoing attachments and the card key are sealed.
- **M1** Containers: `cap_drop ALL`, `no-new-privileges`, read-only root, tmpfs, pids and memory limits, non-root users.
  Per-connector env files. Metadata server reachable only from the two named bridges, re-applied on every Docker start.
  ffmpeg runs with `PATH` only, pipe-only protocol, forced input format, size and time limits.
- **M2** VM script: no public address, own VPC with Cloud NAT, SSH only from IAP, OS Login with 2FA, shielded VM.
- **M3** Fences everywhere (triage, drafts, learn, voice, signals, meetings, brief, automations). Rules start tentative,
  live at the second supporting pass, and reject addresses, links, digit runs and payment words. Header checks can only
  raise `suspicious`. Twins keyed on user, Message-ID, sender and subject. Fact guard holds risky pre-drafts for review.
- **M4** Push endpoints allow-listed in the database and the worker, vetted lookup, 10 second timeout, parallel, paged.
- **M5** The admin-consent link is built server-side from our own client id; the query parameter is ignored.
- **M6** Apple password cleared on success or failure and swept after 10 minutes; rows gone after an hour. Handoffs sealed
  per user with purpose binding; the old format is no longer read.
- **M7** Forty model reads per sender per day; voice notes from strangers wait; their own budget share.
- **M8** Unsubscribe scan capped and linear: 5 ms on 200 KB of adversarial input.
- **M9** `keyAccess` runs inside `signedInUser`, so every one of the 27 routes requires aal2 once a factor exists.
  Deletion cancel needs the same proof as the request. Index and local copy wiped at boot without a session.
- **M10** Every assignment logged by trigger; the app cannot insert assignments directly.
- **Low** From-own-address needs DMARC pass; meeting URL anchored; unsubscribe to one address with a fixed subject and
  body; LinkedIn proxy, iCloud, Google photos, Graph and Zoom pinned; IMAP, Zoom and photo sizes capped; vault raises
  instead of writing plaintext; ownership policies on links, views and the composer; secret tables revoked; owner needs a
  confirmed email; `.gitignore` covers keys and captures; env files 0600; CI read-only with SHA-pinned actions; `go test`
  runs; release gate requires green CI; VM env staged in a 0700 temp dir; health endpoints on loopback; logs shipped.
- **Git history** 376 commits grepped for private keys, service-account JSON, JWTs, API keys and client secrets: only
  code references. No env, key or HAR file was ever added.

## Yesterday's Findings: Not In Effect

| Item | State | What is missing |
| --- | --- | --- |
| H1 insiders | Open, by design until Confidential Space | `/api/keys` still hands the raw data key, older keys, index key and team keys to any aal2 session. A service-role or JWT-secret holder can mint one. No step-up for new devices. `local:v1` still wraps new keys in any process without `KMS_KEY_NAME`. |
| H4 binding | Built, off | Flags off, `fields:bind` not run, `20261126100900` not applied. |
| M1 pip hashes | Not done | No lock file, so the image and CI fall back to an unpinned `pip install`. The connectors that run this unpinned code hold the service-role key and reach the metadata server. |
| M1 build in CI, deploy by digest | Not done | No registry, so `release.sh` builds on the VM (when there is one). |
| M3 View Original repoint | Partly | Messages stored before `20261124110000` have no `content_index`, so a same-Date re-send with the same Message-ID still repoints them. Needs a backfill or dropping the Date fallback. |
| M7 per-sender cap | Partly | Keyed on the From address, so rotating addresses gets 40 reads each until the user's whole share is spent and triage stops for them. In-memory, per process. |
| M3 learned rules | Partly | The filter is English keyword based: "proof of payment goes to accounts at konva-pay dot co dot za" and an Afrikaans bank-details rule pass `learnable()`. Rules stored before 4 November were never re-filtered. |
| M9 sessions | Partly | Refresh token still in localStorage. Session lifetime is a dashboard setting nobody has checked. |
| Low: `instagram_sign_ins` | Missed | RLS with zero policies but no `revoke all`, unlike the other secret tables. |
| Low: HAR captures | Not done | Still on disk, 0644. |
| Low: Realtime DELETE | Not done | See new finding 1. |

## New Findings

Severity is against the same three attackers as yesterday: an outside sender, another signed-in user, and an insider or
anyone holding a production secret. CONFIRMED means the reviewer traced the path end to end or probed it; this pass
re-checked every Medium by hand.

### Medium

1. **Calendar event deletions are broadcast whole to every signed-in user.** CONFIRMED.
   `20261117100000_calendar_events_realtime_and_range_index.sql:19` sets `replica identity full` and the table is in the
   `supabase_realtime` publication. Realtime cannot apply row security to DELETE events, and with FULL identity the whole
   old row goes out. The `user_id=eq.<me>` filter in `use-calendar-data.ts:169` is chosen by the client. Any signed-in
   user subscribing without it receives every tenant's deleted events: user id, account id, calendar id, provider event
   id, start and end, recurrence, plus the sealed columns as ciphertext (plaintext for any row written before encryption
   was on). Fix: `replica identity default` and handle deletes by id as the threads channel does. Half a day with a
   migration and a check that no other published table uses FULL.
2. **Automations act on spoofed and flagged mail and pre-address a reply to the attacker.** CONFIRMED.
   `apps/ai/ai/automations/` never reads `message_ai.suspicious`, `threads.suspicious` or `provider_meta.auth` (grep is
   empty). A forged "noreply@property24.com" enquiry carrying the attacker's own email and number produces a new Lead, a
   "Call Back Within 5 Minutes" task with the attacker's number, an urgent push, and a pending draft whose `reply_to` is
   the attacker's address, even if DMARC failed and triage said impersonation. `_urgent` then lowers `junk` to false.
   Fix: skip flagged and auth-failed messages in `_after`, and never lower `junk` on a flagged thread. Half a day.
3. **Pre-drafts are queued for suspicious mail.** CONFIRMED. `queue_auto_draft` and `triage_predraft.candidates` check
   `needs_reply and not junk` only. A phishing mail asking "can you confirm you'll action this today?" gets a live
   pre-draft unless the fact guard happens to find a high-risk detail. Fix: one condition in each. An hour.
4. **Message-ID squatting drops a future legitimate email.** CONFIRMED by tracing. `20261124110000` returns `duplicate`
   and stores nothing for any later mail reusing a Message-ID in the account. Many senders use predictable ids (GitHub
   `<org/repo/pull/124@github.com>`, ticketing systems). An outside sender pre-sends one and the real notification is
   dropped silently. Fix: key dedupe on the provider's own id (Gmail id, Graph id, folder plus UID) and content hash, and
   store a non-matching reuse as a new message. One day.
5. **Team key retirement races the browser's key hold.** CONFIRMED. `share/rotate.ts:64,304` retires the old version 90
   seconds after first seen; browsers hold team keys for 10 minutes (`vault.ts:30`) and seal shared notes, client lists,
   company voice and compliance exports with them. A colleague's write in that window becomes "Unreadable" forever. Fix:
   retire after the browser refresh interval plus margin, or push a Realtime event that forces a key refresh. Half a day.
   Only matters once a team has rotated.
6. **The team index key is the raw version-1 data key, handed to every member forever.** CONFIRMED. `teamKeyring` sets
   `indexRoot.key` to the first version's unwrapped key and `/api/keys` returns it as `indexKey`. A member who joins after
   a rotation still receives the key that sealed all pre-rotation team data. User keys do this correctly with a derived
   HMAC key. Fix: wrap a derived index key into `team_keys` at the first rotation and hand out only that. One day.
7. **`push-web-env.sh` re-pushes retired keys.** CONFIRMED. No allow-list; it uploads every non-localhost line of
   `.env.local`. The runbook's "remove from Vercel by hand" is undone by the next run. Fix: mirror `push-env.sh`'s
   allow-lists and refuse the retired names. An hour.
8. **Loss of the KMS key is total and undocumented.** CONFIRMED as a gap. Every user's data key is wrapped under one KMS
   key that cannot be exported. Nothing in the runbook says that destroying the key version, key ring or project makes
   every backup unreadable; there is no project lien, no restriction on key destruction, and no alert on
   `DestroyCryptoKeyVersion`. Fix: document the stance, add a lien, set the destroy-scheduled duration to the maximum,
   alert on destroy. Half a day plus console steps.
9. **Unpinned Python dependencies in the containers that hold the keys.** CONFIRMED. See "Not in effect" above. Fix:
   run `deploy/lock-ai-requirements.sh`, commit the locks, add `pip-audit` to CI, move `cryptography` to 50.0.2. Half a
   day.
10. **Team admins can read any member's chats through cover, unlogged.** CONFIRMED. `set_cover`
    (`20261104100000:270`) lets an owner or admin name themselves cover for any active member for up to 184 days with no
    absence check; `i_cover` then satisfies `can_read_thread` and `is_assignee` with nothing in `thread_assignment_log`.
    This undoes the M10 fix by another door. Fix: log cover grants in the same log and notify the member, or require their
    consent unless they are inactive. Half a day.

### Low

- **CSP missing on dynamic routes with a file-like suffix.** `middleware.ts:26` excludes paths ending in an image or
  PDF extension by regex; `/inbox/anything.pdf` renders the full app with no Content-Security-Policy. Match by path
  prefix instead, or add a fallback CSP header.
- **OAuth callbacks unwrap keys for any user id in a forged cookie.** The user id is read from the clear prefix of the
  handoff cookie and `credentialKeys` calls KMS before the AES-GCM open fails. No limiter on callbacks. Burns KMS quota
  and money per guessed id. Rate-limit callbacks and check an HMAC or the `state` first.
- **Stale sweep leaves a partial streamed draft in a failed row.** `drafts.py:188-193` marks pending rows failed
  without clearing `body`; a half-written draft repeating a sender's bank details can sit there. Add `body: None`.
- **Batch API jobs are never deleted** after collection, so inlined bodies stay on Google's side for its retention
  window.
- **Custom-automation `listing_url` is only length-cut** and lands in the user's task notes. Keep URL fields only when
  they appear in the mail's own links on an allow-listed host.
- **Header spoof check uses the contact's stored name**, not the message's From display name.
- **Worker trusts user-writable `accounts.send_addresses`** for the Gmail and Outlook From address; only the provider's
  alias enforcement stands between a compromised session and a spoofed From.
- **Forged `Authentication-Results` counts on IMAP hosts that add none**; a sender's own `dmarc=pass` header is read as
  the provider's. Trust it only when the authserv-id matches the account's provider.
- **`isVouched` accepts any DKIM pass**, so a forged From signed by the attacker's own domain can redirect an unsubscribe.
- **WhatsApp media keys stored unsealed** in `provider_meta`; an insider with database read can decrypt media from
  WhatsApp's CDN while the link lives.
- **WhatsApp media download has no timeout**; a stalled CDN connection holds that account's media pass.
- **`DIRECT_PATH` allows a leading `//`**; safe only because Baileys concatenates strings today.
- **One-click unsubscribe POST honours any port**; force 443 as the GET path does.
- **`release.sh` accepts any check-run with the right name** from any app; filter on `app.slug` and the head branch.
- **`main` is unprotected on GitHub.** A direct push skips review, and nothing requires CI before merge.
- **`.dockerignore` lacks the secret patterns** that `.gitignore` has.
- **No `govulncheck`** for the Go helper.
- **Approved-list oracle**: sign-up with the anon key tells anyone whether an address is approved or invited. Inherent to
  a database-enforced allow-list; rate limit at the edge.
- **Any workspace admin can admit any email** through an invite. By design, but it qualifies "approved emails only".
- **`request_transcription`** lets any shared-chat reader spend the chat owner's Voice Notes allowance.
- **No daily cap on `document_reads` and `bulk_reads`** (each a Gemini call), only the overall allowance.
- **Rate limits fall to one shared "unknown" bucket** when Vercel's forwarded-for header is absent (self-hosting).
- **`/api/waitlist` and `/api/meta/webhook`** read the body without `readCapped`; chunked bodies bypass the size check up
  to Vercel's platform limit.
- **AI-connector seals bind to no place** (`place=""`) once `SEAL_BOUND_FIELDS` is on; harmless today, inconsistent with
  the plan.
- **The privacy page** still says "a data key that belongs to you"; the security page is honest that servers use it.
  Align the privacy line.
- **`rate_limit_hit`** still has `search_path = public, pg_temp`; the body qualifies every name, so no effect.

## What Is Not Built Yet

From `docs/PLAN.md` "Not Done" and the runbook's owner actions, in the order they matter:

1. **Production VM.** Create it with `deploy/create-vm.sh`, push env with `deploy/push-env.sh`, release with
   `deploy/release.sh`. Then stop the laptop processes. This moves the service-role key, KMS access and every live session
   off a personal machine and behind IAP, OS Login 2FA and the metadata guard.
2. **Workload Identity Federation for Vercel** (code supports `GCP_WORKLOAD_IDENTITY_PROVIDER`), then delete the
   service-account key in IAM and `GOOGLE_APPLICATION_CREDENTIALS_JSON` in Vercel.
3. **Bound-field rollout**: flags on in web, worker and AI; `fields:bind`; `REQUIRE_BOUND_FIELDS`; apply
   `20261126100900`; one `keys:rekey --all`.
4. **Step-up proof on `/api/keys`** for new devices and old sign-ins (designed, needs a re-auth dialog).
5. **Confidential Space.** The only fix for an insider holding the service-role key. Deliberately deferred to the first
   paying client; the public security page says so.
6. **Connectors' own identity** so instagrapi and pyicloud never hold KMS access.
7. **Images built in CI and deployed by digest** (registry needed).
8. **Supabase dashboard**: TOTP on, leaked-password protection, session lifetime, point-in-time recovery.
9. **Two-factor sign-in** on the Google, Vercel, Supabase and GitHub accounts; branch protection on `main`.
10. **Error tracker and alert policies** (the runbook lists them).
11. **Google OAuth verification and the CASA assessment.** Konva requests `gmail.modify`, a restricted scope, plus
    `chat.messages` and `drive.file`. Google requires app verification and an independent CASA Tier 2 assessment before
    the app can serve more than 100 Gmail users. The security page already promises this. Microsoft publisher
    verification is the equivalent for Outlook. Start now: the queue is weeks to months.

## Weak Points A Partner Will Ask About

These are not bugs. They are the honest limits of the design today, and the answers should be ready.

- **Konva can read the data.** Encryption is per user under KMS, but Konva's servers hold the keys to do their work, and
  the founder holds the service-role key. The security page says this plainly. Confidential Space is the planned fix.
- **Unofficial channels.** WhatsApp (Baileys), LinkedIn (mautrix-linkedin) and personal Instagram (instagrapi) use
  reverse-engineered protocols. They can break without notice, and the platforms' terms allow them to suspend the user's
  account. iCloud Mail uses an app-specific password typed into Konva, checked and then sealed, and iCloud Reminders uses
  pyicloud with the Apple ID password held for minutes. A partner selling to professionals needs this in the contract and
  the onboarding copy.
- **One person, one laptop.** Until the VM exists, availability and confidentiality both depend on one machine.
- **AI reads everything.** Every message goes to Gemini for triage. The key's tier decides whether Google retains or
  trains on it; the security page claims an enterprise service that does not train. Confirm the key is on a paid tier with
  that commitment, and that it is Konva's own key, not shared with another product.
- **The session lives in localStorage.** A script injection or a copied browser profile reaches the data key. The
  enforced nonce CSP and the sandboxed email frame are the controls; step-up on `/api/keys` is the next one.

## What To Do Before Launch, In Order

Estimates are Claude-built time, before review and testing.

| # | Step | Who | Time |
| --- | --- | --- | --- |
| 1 | Delete `KEY_WRAPPING_KEY` and `ENCRYPTION_KEY` from Vercel, the laptop env files and `.env.example`; restrict every remaining Vercel secret to Production and mark it Sensitive; fix `push-web-env.sh` | owner and code | 2 hours |
| 2 | Create the VM, push env, release, stop the laptop processes, delete the HAR captures | owner | half a day |
| 3 | Workload Identity Federation for Vercel, delete the service-account key | owner and code | half a day |
| 4 | Fix Mediums 1, 2, 3 and 7 (calendar replica identity, automations and pre-drafts on flagged mail, env push allow-list) | code | 1 day |
| 5 | Bound-field rollout (flags, `fields:bind`, require, apply `20261126100900`, `keys:rekey --all`) | owner and code | 1 day |
| 6 | Python locks, `pip-audit` and `govulncheck` in CI, `cryptography` to 50.0.2, `instagram_sign_ins` revoke, `.dockerignore` patterns, branch protection on `main` | code and owner | half a day |
| 7 | Mediums 4, 5, 6, 10 (Message-ID dedupe, team key window and index key, cover logging) | code | 2 to 3 days |
| 8 | Supabase dashboard settings, 2FA on every account, KMS lien and destroy alert, runbook "key loss" section | owner | 2 hours |
| 9 | The Low list | code | 2 days |
| 10 | Google OAuth verification and CASA, Microsoft publisher verification | owner, external | start now |
| 11 | Step-up on `/api/keys` | code | 1 day |
| 12 | Confidential Space | code and owner | at the first paying client |

After steps 1 to 8 the honest statement to a partner is: every tenant's data is isolated and encrypted per user under a
hardware-backed key, the services run on a locked-down machine with no public address, the model never acts on its own,
every finding from two independent audits is closed or scheduled, and the remaining limit is that Konva's own servers
can read what they process, which Confidential Space removes.

## Could Not Verify

- Supabase dashboard: TOTP enabled, leaked-password protection, session and refresh lifetimes, point-in-time recovery,
  who holds the JWT secret. The Supabase MCP connector needs authorising before it can read the advisors.
- Google Cloud: KMS destroy-scheduled duration, who has Owner on `messages-keys`, Picker API key referrer restriction.
- Gemini: the key's tier and retention terms, and whether Konva's key is its own (memory says it was copied from Mendr).
- Whether any `style_rules` rows stored before 4 November carry an address or link (sealed; a scripted check would need
  the keys).
- Whether a workspace has rotated its team key yet (decides whether Mediums 5 and 6 are live).
- Runtime Realtime DELETE behaviour on this project version (the finding rests on Supabase's documented behaviour).

## Audit Notes

- Runtime checks were read-only: `keys:readiness` (counts only), a head-count probe for migration presence, Vercel
  variable names (values were returned encrypted and were not decrypted), `gcloud` list and get-iam-policy, Supabase's
  public `/auth/v1/settings`, `gh api` for branch protection, `ps` for local processes.
- The infrastructure reviewer fetched public advisory pages for the dependency table. No reviewer sent anything, used a
  write tool, or modified a file. One reviewer created and deleted a throwaway worker test file.
- Test suites run locally during the review all passed: crypto 57, Python 1209, worker 1115, web 276.
