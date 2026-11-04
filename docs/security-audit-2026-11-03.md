# Security Audit, 3 November 2026

Read-only static review by seven parallel auditors (database, web server, web client, encryption, sync worker, AI worker,
infrastructure). Nothing was run against Supabase, Gmail, Vercel or any live service, and no files were changed. The two
top High findings (WhatsApp media fetch, automation identity merge) were re-checked by hand against the source.

Severity is ranked against three attackers: an outside sender (anyone who can email or message a user), another
signed-in user, and an insider or anyone holding a production secret (service-role key, Vercel env, VM).

## Summary

Tenant isolation is strong. Every public table has RLS. No user-id-trusting RPC is callable by a signed-in user. The
workers re-check ownership on every queued job, and the web routes check ownership on every request. No IDOR was found.
No secrets are in the repo or its git history. XSS from email HTML is well contained (sandboxed iframe, nonce CSP). The
AI never sends, forwards or archives on its own.

The real risks are in four places:

1. **The encryption does not protect against insiders or a compromised server.** Anyone holding the service-role key or
   the Vercel/VM environment can decrypt every user's data.
2. **Several "should be encrypted" fields are plaintext.** These are contact, company and group names, calendar guests
   and notes, and outgoing attachments.
3. **Outside senders can reach internal systems or poison data.** This happens through WhatsApp media URLs, lead-capture
   automations and prompt injection into learning, triage and drafts.
4. **Build and runtime hygiene on the workers VM.** Dependencies run where KMS-decrypt tokens are one request away.

## High

### H1. Insiders and server compromise can decrypt everything
- `/api/keys` hands the raw per-user data key to any valid session. A service-role holder can mint a session for any
  user, and admin factor deletion drops it to aal1 (`apps/web/app/api/keys/route.ts`, `apps/web/lib/server/keys.ts`).
- Vercel holds the service-role key, `KEY_WRAPPING_KEY`, `ENCRYPTION_KEY` and a long-lived service account JSON with
  KMS decrypt on the user-keys key (`deploy/push-web-env.sh`).
- The legacy `KEY_WRAPPING_KEY` (`local:v1`) is still accepted and sits in web, worker, AI and laptop env files. Data
  keys are never rotated, so anyone who ever held that key, plus any old backup, opens everything
  (`packages/crypto/src/wrap.ts`, `apps/worker/scripts/rewrap-keys.ts`).
- Fix:
  - Finish `rewrap-keys` and `credentials:reseal`, then delete `KEY_WRAPPING_KEY` and `ENCRYPTION_KEY` everywhere.
  - Replace the service account JSON with Workload Identity Federation.
  - Require step-up re-auth on `/api/keys`.
  - Add a data-key re-key job.
  - Confidential Space remains the real fix.

### H2. WhatsApp media download fetches a sender-controlled URL (SSRF and worker crash) [verified]
- `apps/worker/src/whatsapp/media.ts` stores the sender's `url` and `directPath`. In Baileys, the host comes from `url`
  even when `directPath` is set, and a bare `url` (including `http://`) is fetched verbatim
  (`node_modules/baileys/lib/Utils/messages-media.js:416-418`).
- There is no host allowlist and no size cap; the file is buffered in memory before the size check.
- Attack: anyone who messages a linked number makes the worker GET an internal address. They can also stream gigabytes
  to OOM the single worker for every tenant, and the missing-media retry makes it repeat.
- Fix:
  - Ignore `url` and force the host to `mmg.whatsapp.net`.
  - Validate `directPath`.
  - Stream with a hard byte cap.

### H3. Lead-capture automation attaches an attacker's phone or email to an existing trusted contact [verified]
- `apps/ai/ai/automations/do.py:113-140`: if the enquiry's email OR phone matches a contact, the other identifier from
  the message body is added to that contact with no check.
- Attack:
  - Someone submits a real Property24 (or custom) enquiry with a client's email and their own phone number.
  - Their WhatsApps now resolve to that client, inheriting VIP and triage trust, notes and draft context.
- Fix:
  - Never add an identifier to a contact matched on a different identifier.
  - Create a separate unverified lead or ask the user.

### H4. Ciphertext is not bound to its row, and plaintext is accepted where ciphertext is expected
- The AAD is only the field kind (`"body"`, `"subject"`) (`packages/crypto/src/index.ts:91-110`). Readers pass
  unprefixed values through, and failed decrypts become `""`.
- Attack: anyone with DB write, such as a service-role leak, can copy a confidential `messages.body_text` ciphertext into
  an `outbox` row with a plaintext attacker address. The worker then decrypts it and sends it from the victim's own
  mailbox. Sealed attachments can be swapped for plaintext ones, for example invoices with altered bank details.
- Fix:
  - Add `table.column|row_id` (and user) to the AAD under a new `e2:` format.
  - Reject unprefixed values in always-sealed columns, with CHECK constraints once the backfill is done.

### H5. Plaintext that the design says is encrypted
- **Outgoing attachments:** bytes and filenames stored raw in Storage and `outbox_attachments.filename`, and kept 7+
  days (`apps/web/lib/outbox-files.ts`, `apps/worker/src/send/outbox-attachments.ts`).
- **Contact, company and WhatsApp group names:** `contacts.display_name`, `organizations.name`, `threads.group_name`
  (`apps/worker/src/ingest/store-email.ts:104`, `whatsapp/person.ts`, `whatsapp/names.ts`). AGENTS.md says names are
  encrypted.
- **Calendar:** attendees, description, conference URL and calendar name are plaintext, and the attendee CHECK
  constraints in `calendar_outbox` and `calendar_updates` make sealing impossible (`20261023300000_new_anything.sql`).
  Teams `join_url` is also plaintext.
- **`address_book_cards.card_key`:** an unkeyed SHA-256 of name, emails and phones, which can be brute-forced offline for
  phone-only cards (`apps/worker/src/contacts/cards-store.ts:39`).
- Fix:
  - Seal each of these.
  - Relax the attendee CHECK to accept `e1:`.
  - HMAC the card key with the index key.
  - Correct AGENTS.md until done.

## Medium

### M1. Workers VM: dependencies and unofficial libraries run next to KMS-decrypt credentials
- Images are built on the production VM (`deploy/release.sh`), and pip installs have no hashes. Containers and build
  steps can reach the metadata server, and the VM service account can decrypt user keys.
- The Instagram (instagrapi) and iCloud (pyicloud) containers share the full AI env: service-role key, Gemini key and
  both static keys (`deploy/compose.yaml:36-48`).
- ffmpeg runs on user-uploaded bytes with the worker's full env, auto-detected demuxers and no protocol whitelist. It
  can be reached through user-writable `mime_type` and `voice_note` (`apps/worker/src/whatsapp/gif.ts`, `voice-note.ts`).
- There is no container hardening (cap_drop, no-new-privileges, read_only, memory limits).
- Fix:
  - Build in CI and deploy by digest, with `--require-hashes`.
  - Block 169.254.169.254 from containers.
  - Give each connector its own minimal env file.
  - Run ffmpeg with `env: {}`, `-protocol_whitelist pipe`, a forced input format and a magic-byte check.

### M2. VM network exposure (needs runtime check)
- `deploy/create-vm.sh` gives the VM a public IP on the default network, where `default-allow-ssh` and
  `default-allow-rdp` are usually open to the world.
- Fix: `--no-address`, IAP-only SSH, delete the default rules, and enable OS Login 2FA.

### M3. Prompt injection with persistent or cross-thread effect
- **Learned rules:**
  - The learn, signals and voice prompts have no fence around draft and sent text, and `outbox.body` is not `clean()`ed
    (`apps/ai/ai/learn.py:196`).
  - Rules pass with URLs and addresses, and voice and signals rules go live immediately. They are then injected
    unfenced into every future draft (`drafts_prompt.py:155`).
  - Risk: a sender can plant "always CC x@evil".
- **Triage** is the only phishing control and is model-steerable.
  - Model-written `decision` text goes unfenced into the draft prompt.
  - Verdicts are copied between messages sharing a Message-ID (`triage_context.py`).
  - Related: a duplicate Message-ID repoints an existing message's `provider_meta`, so "View Original" and attachment
    fetch then show the second mail's content (`ingest_email`, `apps/worker/src/ingest/store-email.ts`).
- **Drafts** can pull other clients' threads in through similarity retrieval.
  - The fact guard counts attacker text as evidence and never blocks.
  - Pre-drafts appear without a click (`drafts_gather.py`, `drafts_facts.py`).
- **Meeting transcripts** are not fenced, so injected text can become action items (`meetings.py:315`).
  - Those summaries can be turned into notes. The notes editor accepts remote markdown images, which load from an
    outside server on every open (`apps/web/lib/note-markdown.ts`, `note-meeting.ts`).
- Fix:
  - Fence everything untrusted.
  - Reject learned rules with `@`, URLs or digit runs, and make all learned rules tentative.
  - Add deterministic header checks (SPF/DKIM/DMARC, display-name mismatch) that the model cannot downgrade.
  - Key dedupe on provider place, not Message-ID.
  - Restrict note images to `attachment:` sources.

### M4. Push sender: blind SSRF and a one-user platform-wide push outage
- Users write any https `push_subscriptions.endpoint`. The CHECK constraint is `NOT VALID` and does not stop DNS names
  that resolve to private addresses.
- `webpush.sendNotification` has no timeout, and sends are sequential, so one hanging endpoint stops push for everyone.
- The subscription read is unpaged (1000-row cut).
- Locations: `apps/worker/src/push/sender.ts`, `20261102100400_push_endpoint_check.sql`.
- Fix:
  - Allowlist push-service hosts.
  - Resolve endpoints with a vetted lookup.
  - Set a 10s timeout, send in parallel and page the read.
  - Validate the constraint.

### M5. Microsoft admin-consent link can be injected from the URL
- `apps/web/app/settings/accounts/microsoft/page.tsx:58` shows `?admin=` as the official "Ask Your IT Admin to Approve"
  link after only a prefix check. The stricter `isAdminLink` in `api/connect/microsoft/shared.ts:31` is unused.
- Risk: consent phishing for an attacker's Azure app.
- Fix: build the link client-side from our own client id and ignore the parameter.

### M6. Static shared `ENCRYPTION_KEY` guards live Apple ID passwords
- `icloud_setups.sign_in` holds the Apple ID and real password sealed under one static key with no AAD.
  `Setups.ready()` does not clear it, and there is no retention sweep (`apps/ai/ai/connectors/icloud_reminders/setup.py`,
  `apps/web/app/api/connect/icloud-signin/route.ts`).
- The same key seals all OAuth handoff cookies, with no purpose binding.
- Fix:
  - Clear `sign_in` on success.
  - Add a minutes-long retention sweep.
  - Seal handoffs under per-user keys with purpose AAD.

### M7. Outside senders can exhaust a user's AI allowance
- There is no per-sender cap on triage or voice-note transcription.
- Voice notes share the `transcribe` budget with meeting summaries (`triage_signals.py`, `transcribe.py`).
- Fix:
  - Add per-sender and per-day caps.
  - Defer voice notes from unknown contacts.
  - Use separate budget features.

### M8. ReDoS in the body unsubscribe-link regex
- `apps/worker/src/send/unsubscribe.ts:64` is quadratic on long `www.www.www...` runs and blocks the shared worker's
  event loop when Unsubscribe is clicked.
- Fix: cap the scanned text, and split the regex into two linear passes.

### M9. Session and device theft gives full decryption
- The Supabase session (refresh token) lives in localStorage, so a copied profile or any XSS can call `/api/keys`.
- aal2 is enforced only on `/api/keys`. The connect routes and account-deletion cancel accept aal1 sessions.
- The search index wipe only runs on `SIGNED_OUT` from a mounted hook.
- Locations: `apps/web/lib/supabase.ts`, `apps/web/lib/server/request.ts`, `apps/web/lib/search/use-indexer.ts`.
- Fix:
  - Shared aal2 guard on all state-changing routes.
  - Shorter sessions.
  - Wipe the index at boot when there is no session.

### M10. Team admins can read any work chat by assigning it to themselves, with no audit
- `assign_thread` allows owners and admins to assign to themselves. Unlike Compliance opens, nothing is logged or shown
  to the agent (`20261103100000_team_owner_features.sql:258`). This contradicts the wording in
  `20261104100000_team_after_launch.sql`.
- Fix: log every assignment and notify the agent, or require consent.

## Low

- **Spoofing and phishing:**
  - Inbound mail forged From the user's own address is stored as outbound and read (`store-email.ts:86`).
  - `isMeetingUrl` is unanchored, so `https://evil/?u=https://zoom.us/j/1` shows as "Join Meeting"
    (`calendar/meeting-link.ts`).
  - AI-labelled link buttons in Readable Bulk Email hide the host behind a friendly label.
- **Unsubscribe:** the mailto `to` accepts commas, and the subject and body are sender-chosen, so a click can send an
  attacker-authored mail from the user's mailbox. The List-Unsubscribe header is chosen by spoofable From
  (`send/unsubscribe-flow.ts`).
- **Ownership defence in depth:**
  - `account_composer` (PK squat DoS), `note_links`, `matter_links`, `thread_links` updates and `saved_views` do not
    check ownership of referenced ids.
  - The worker trusts RLS for `mail_actions` and unsubscribes.
  - Secret tables (`account_credentials`, `whatsapp_auth_keys`, `sync_state`, `mail_hints`) rely on zero policies with
    no `revoke all`.
- **Network:**
  - The IMAP connect route works as a credential-probe relay to any public mail host. Sign-up is open although PLAN says
    closed beta.
  - The `APP_URL` fallback uses request headers, and `APP_URL` is missing from `.env.example`.
  - The waitlist is first-write-wins by unverified email.
  - The Graph notify endpoint has no replay protection or limiter.
  - The LinkedIn sign-in proxy skips the vetted address.
  - iCloud CardDAV and photos are not host-pinned and follow redirects.
  - Instagram media fetch accepts any scheme and host.
  - Microsoft and Zoom clients attach tokens to unpinned URLs.
- **Resources:**
  - Unbounded memory on IMAP source, Zoom recordings and profile photos.
  - pdf.js renders on the main thread.
- **Python vault:** writes plaintext when a user has no `user_keys` row (`apps/ai/ai/vault.py:211`).
- **Infra and CI:**
  - `push-env.sh` stages env files in world-readable `/tmp` on the VM.
  - No log shipping.
  - Release deploys whatever is on `origin/main` with no CI gate.
  - CI has no `permissions:` block, tag-pinned actions and no `go test`.
  - Laptop env files are mode 0644.
  - LinkedIn HAR captures holding cookies sit in the repo folder (gitignored).
  - `.gitignore` lacks `*.pem`, `*.key`, `*.har`.
- **Realtime:** DELETE events are not RLS-filtered, so other users' row ids and delete timing may be visible
  (runtime check).
- **Owner:**
  - `analytics_owner_id()` trusts an unconfirmed email.
  - The owner email is hard-coded in the client bundle (UI only).
- **Copy:** the marketing security page says the data key "belongs to you alone", which is stronger than the
  architecture.

## Needs a Runtime Check

These are not visible in the repo (no `supabase/config.toml`, VM not yet created):

- Supabase Auth settings:
  - open sign-up
  - email confirmation (invites and owner checks depend on it)
  - MFA enforcement
  - session lifetime
  - redirect URL allowlist
- Whether all later migrations, including the `is_analytics_owner` fix, are applied in production.
- GCP firewall rules and the IAM scope of `konva-keys.json`.
- Google Picker API key referrer restriction.
- Whether WhatsApp media poison messages re-trigger after restart.
- Whether Tiptap renders remote markdown images.

## Quick Wins (Small, High Value)

1. WhatsApp media: drop `url`, pin the host, and cap bytes (H2).
2. Automation: stop merging identifiers into matched contacts (H3).
3. Microsoft admin link: ignore the query parameter (M5).
4. Push sender: add a timeout, parallel sends and a host allowlist (M4).
5. iCloud setups: clear `sign_in` on success and add a retention sweep (M6).
6. ffmpeg: `env: {}` and `-protocol_whitelist pipe` (M1).
7. Unsubscribe regex cap; anchor `isMeetingUrl` (M8, Low).
8. `revoke all` on secret tables; CI `permissions: contents: read`; `chmod 600` local env files.

## Audit Notes

- The infrastructure auditor ran one network command, `git ls-remote --heads origin`, a read-only branch listing. It
  broke the no-network rule but changed nothing.
- No auditor used MCP tools, sent anything, or modified files.
