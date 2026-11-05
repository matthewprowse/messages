# Launch Checklist (4 November 2026)

What stands between today and a closed beta with paying South African estate agency offices. Built by checking every
"done" and "not done" line in `docs/PLAN.md` against the code (read only; the production database was not queried, so
anything about applied migrations or dashboard settings needs a live check). Tick items off here; record decisions in
`docs/PLAN.md`.

## Must Do Before the First Pilot Office

### Ship What Is Built

- [ ] Commit and push the working tree. About 60 files are untracked (the browser tests, about 38 component tests, the
      Faster AI files `drafts_stream.py`, `gemini_stream.py`, `gemini_shared_cache.py`, `triage_predraft.py`, migration
      `20261126110000_worker_pre_drafts.sql`) and the security fixes are uncommitted. `deploy/release.sh` ships
      `origin/main` only, so none of it can reach production yet.
- [ ] Apply migrations `20261115*` to `20261126*` to production (`bbfahndgnmdlehicmphe`) and confirm what is applied.
      This includes `approved_signups`: without it sign up stays open. PLAN.md contradicts itself on whether the Teams
      migrations are applied (lines around 1698 and 2476); fix the line after checking.
- [ ] Create the workers VM (`deploy/create-vm.sh`), move the workers off the laptop, delete the default firewall rules,
      set up IAP and OS Login.

### Accounts and Legal

- [ ] Register the company, then fill the `<Fill>` placeholders in `app/(marketing)/privacy/page.tsx` (5) and
      `terms/page.tsx` (3): company name, registration number, address, Information Officer, emails, backup period.
- [ ] Fix the Privacy Policy Teams wording: it says shared conversations are "visible to its members", but only the
      agent, assignees and Compliance can see them. Add that team chats are protected by access rules.
- [ ] Buy the domain and set `NEXT_PUBLIC_SITE_URL` (it falls back to localhost), Supabase redirect URLs, custom SMTP and
      the `{{ .Token }}` email template.
- [ ] Supabase Auth: Confirm Email on, leaked password protection, TOTP.
- [ ] Check the employment contract for side business and IP clauses.

### Google and Gmail

- [ ] Start Google OAuth verification and the CASA assessment now. Until it passes Gmail is capped at 100 test users with
      the unverified warning screen, and Testing mode sign-ins expire after 7 days.
- [ ] Give the AI worker its own Gemini key, separate from Mendr.

### The Estate Agent Feature

- [ ] Test the Property24 and Private Property lead parsers on real enquiry emails (read only). They were written from
      the public layout and never run on a real enquiry. Lead capture is the core of the agent pitch.

### Getting Paid

- [ ] Billing. There is no payment code (no Paystack). Seats are set by hand in Admin. Free pilots can start without it,
      but it must exist before the first 30 day pilot ends, or invoice by hand and say so.

## Should Do Before Launch

### Security and Keys

- [ ] KMS: run the rewrap and `credentials:reseal`, then retire `KEY_WRAPPING_KEY` and `ENCRYPTION_KEY`
      (`docs/RUNBOOK.md`, around line 240). The public Security page already says keys are held under Google Cloud KMS.
- [ ] Workload Identity Federation for Vercel's KMS access, then delete the JSON key.
- [ ] Roll out `SEAL_BOUND_FIELDS` and `REQUIRE_BOUND_FIELDS` (built, switched off).
- [ ] Step up re-auth on `/api/keys` (audit H1).
- [ ] Revoke Google and Microsoft refresh tokens and log out the WhatsApp linked device when an account is removed or
      deleted. Nothing in `apps/worker/src/account` revokes today.
- [ ] Point in time recovery backups, and two factor on the Google, Vercel and Supabase accounts.
- [ ] Repeatable row level security tests for Teams (a Member cannot read a colleague's chat). Today it was checked once
      in a scratch database.

### Running in Production

- [ ] VAPID keys, so web push works.
- [ ] Gmail Pub/Sub and the Graph notification URL and secret. Without them mail is polled every 5 minutes.
- [ ] Error tracker DSN, Cloud Monitoring alerts and a container watchdog.
- [ ] Fix the migration replay problems: duplicate version `20261028110700`, the `messages_sender_idx` clash, statements
      without WHERE.
- [ ] Browser tests Phases 3 to 5, and `pnpm e2e` in CI (it is not in `ci.yml`).

### Product Gaps a Pilot Will Notice

- [ ] Label risky connections (WhatsApp, LinkedIn, Instagram personal, iCloud Reminders) as experimental. iCloud
      Reminders has no risk text.
- [ ] Onboarding: the contacts to tidy, practice reply and How You Write steps are still examples; the profile photo is
      not saved (blob URL). Run a new account end to end.
- [ ] First import cap: still 30 days with no cap on conversations (`INITIAL_SYNC_DAYS`).
- [ ] Real account checks still owed: Microsoft mail and calendar, iCloud event creation, Teams, Meet and Google Chat, a
      first Apple ID through the one step iCloud sign-in.
- [ ] WhatsApp call history (built 4 November): confirm on a real call that the length and start time read right.
- [ ] Storage: the 80% and 30 day over-cap emails, and the banner on the Attachments page. A team's file copies are not
      counted in the meter.
- [ ] Decide pre-drafting with the app closed (now built, uncommitted) and update PLAN.md line 648.
- [ ] Microsoft publisher verification, Meta Business Verification and App Review (Instagram Business).
- [ ] Confirm the audio price (`DEFAULT_AUDIO_INPUT_USD_PER_M = 3.00` in `apps/ai/ai/pricing.py` is a guess).

## Later (Not Needed for a Closed Beta)

Confidential Space (do not claim "we can't read your messages" until it is live), referrals in the product, the official
WhatsApp API, LinkedIn's Python helper, MCP connections, Paystack self serve, shared inbox gaps (taking one back, files and
Cc on replies, other channels), team invite emails, the 30 day Trash auto-empty, birthdays, Going Quiet on the Summary,
export gaps (drafts, meetings, style rules), passkeys and Microsoft or Apple sign-in, Zoom, the region move, pip hash locks.

## PLAN.md Brought Up to Date (4 November 2026)

PLAN.md and AGENTS.md now match the code: the removed `/onboarding` page, the Admin views, Updates in Settings, the
phone control sizes, the MVP table, storage, the privacy status, the many "not done" lines that are built, and the
Wave 7 date. Two things still need a decision or a live check:

- [ ] Dialogs: the latest rule (Full App Review and AGENTS.md) is no corner X with a plain button row, but 23 of 58
      dialogs still show the X. Bring the code in line, or change the rule.
- [ ] Whether the Teams migrations are applied in production: the plan says both. Check the live database and fix the line
      under Build Order and Time.
- [ ] Files over 600 lines: `packages/email-text/src/index.ts` (1,140), six connectors, `brief.py` and two Instagram
      files. Split each the next time it changes.
