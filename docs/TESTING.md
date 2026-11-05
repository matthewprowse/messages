# Browser and Screen Tests

The plan for testing every page and feature of Konva in a real browser, on every kind of screen, without anything ever
leaving for a real person. Written 3 November 2026. Status: agreed; Phases 0, 1 and 2 done. Phase 3 is incomplete and deferred to the week of 9 November 2026. One open decision is at the end.

## Where We Are

About 3,500 automated tests run in two minutes: 1,169 in the web app, 1,030 in the sync worker, 1,143 in the AI worker
and 159 in the shared packages. They test logic in plain modules (encryption, parsing, merging, caching rules). What they
do not test:

- **Screens.** 5 test files cover 317 components. Nothing renders a component and clicks it.
- **The app as a whole.** Nothing signs in, loads the inbox and opens a conversation, so a change can pass every test and
  still break a page (the caching pass of 3 November did exactly that: all green, never run signed in).
- **Screen sizes.** The layout changes at 768px (phone to split view) and 1024px. Nothing checks either side of them.

## The Safety Rule

**No test, ever, can send a message, mark something read at a provider, send an invite, unsubscribe, or reach a real
person's account.** This is enforced five ways, so no single mistake can break it.

1. **A separate database with only made-up data.** Tests run against the test Supabase project "Konva Test" (`ammzthqpycofwvxtpyhx`), holding
   fake people, fake conversations and fake accounts. No real email, WhatsApp, LinkedIn, Instagram, calendar or Zoom
   account is ever connected to it, so there is nothing a send could go through. The test runner refuses to start if
   the database address is the production project (`bbfahndgnmdlehicmphe`) or the Marketing project.
2. **No workers.** In Konva the web app never sends anything itself: it writes a row (`outbox`, `mail_actions`,
   `bulk_reads`, `calendar_outbox`, `calendar_updates`, `calendar_deletes`, `task_updates`, `unsubscribes`, `drafts`,
   `briefs`) and the sync or AI worker does the sending. No worker is ever pointed at the test database. Tests check that
   the right row was written; a small fake worker in the test code then marks it done, so the screen's "Sent" and
   "Failed" states are still tested.
3. **A network firewall in the browser.** Every test browser blocks every address except the app itself and the test
   database. A blocked request to Google, Microsoft, Meta, LinkedIn, Apple, Zoom or Gemini fails the test and names the
   address, so a new feature that calls out directly is caught the day it is written.
4. **Never signed in to production.** Opening a conversation for two seconds marks it read, and that sends read receipts.
   So automated tests never sign in to konva.prowse.co.za. The only production checks are the public pages (website,
   pricing, Updates, the login page) and they only read.
5. **Live sends only with your say-so.** Anything that truly sends lives in a separate Live Checks suite (Phase 6) that
   never runs on its own: you start it by hand, type a confirmation for that run, and it can only send to addresses on an
   allowlist that you own.

Two smaller leaks are closed too:

- **Sign-in emails.** Magic link and invite emails come from the database's own mailer. Tests sign in with a password and
  intercept the magic link request, so no email is sent.
- **AI costs.** The AI worker is not run, so no Gemini calls are made. Drafts, triage and briefs are filled in by the fake
  worker with fixed text.

## Two Kinds of Test

### Screen Tests (one component at a time)

- **What:** render one component, such as the composer, the thread row, a filter menu or the New Event dialog, with fake
  data, then click, type and check what it shows and what it calls.
- **Tools:** the existing `node --test` runner with React Testing Library and happy-dom (three dev dependencies). No
  new test runner.
- **Where:** next to the component, as `thing.test.tsx`, as the repo already does for logic.
- **Data:** a fake store provider (`apps/web/test/fake-store.tsx`) built from the same fixtures as the browser tests, so a
  component never needs the database.
- **Speed:** milliseconds each. They run with `pnpm test` and in CI on every push.

### Browser Tests (the whole app)

- **What:** start the real app, sign in as a test user, and use it as a person would: open pages, click through
  features, resize, go offline, reload.
- **Tools:** Playwright, which drives Chromium, WebKit (Safari's engine) and Firefox, and emulates phones and tablets.
- **Where:** `apps/web/e2e/`, one file per area (`inbox.spec.ts`, `calendar.spec.ts` and so on).
- **Data:** each run seeds the test database from fixtures with a fresh user, sealed with that user's test key the same way
  the workers seal real data, so decryption, search and the local inbox copy are tested for real.
- **Realtime:** the fake worker writes rows with the service role ("a new message arrived", "the draft is ready", "the
  reply was sent") and the test checks the screen updates live.

## Screens to Cover

Every browser test runs on the core three; the visual checks run on all of them, in light and dark.

| Name | Engine | Size | Why |
| --- | --- | --- | --- |
| Desktop | Chromium | 1440 x 900 | Most people at work |
| Laptop | Chromium | 1280 x 800 | Smaller screens, the 1024px breakpoint |
| Desktop Safari | WebKit | 1440 x 900 | Mac users |
| Desktop Firefox | Firefox | 1440 x 900 | Smoke tests only |
| iPad Portrait | WebKit | 820 x 1180 | Just above the 768px split |
| iPad Landscape | WebKit | 1180 x 820 | Split view with a narrow list |
| iPhone | WebKit | 393 x 852 | The main phone, installed as an app |
| Small iPhone | WebKit | 375 x 667 | The smallest supported screen |
| Android | Chromium | 412 x 915 | Android phones, Save Data on and off |

Core three: Desktop, iPhone, Android. Each phone test also runs once as an installed app (standalone display mode), since
the PWA is how most people will use Konva.

## What Gets Tested

Each area gets screen tests for its parts and browser tests for its flows. "Queues" means the test checks the row that
would make a worker act, and never lets a worker see it.

**Sign In and Account**
- Sign in with a password; a wrong password; sign out.
- Magic link request (intercepted); MFA prompt for a user with a second factor.
- Invite link: accept, wrong account, expired.
- Delete account, run on a throwaway user.
- Sign out wipes the local inbox copy, the stored pages and the cached links.

**Conversations**
- List: every view and filter, By Person, search.
- Opening a conversation marks it read and queues a `mail_actions` row (the read receipt). Mark All Read queues
  `bulk_reads`.
- Composer:
  - typing, attachments, templates, tone, Writing As;
  - Send queues `outbox` and shows Sent after the fake worker;
  - a failed send shows Retry;
  - undo send.
- Drafts appearing live. Reply choices and Add to Calendar.
- Reactions, labels, snooze, archive, delete and restore.
- Bulk select and actions. Clean Up. Merge conversations.
- Shared chats, the person view, New Email.
- Urgent and Needs Reply tags. The suspicious mail warning.

**Summary**
- List, Filter, Search Summary.
- Your Day: the numbers, the brief as text, the week row.
- Brief player controls, with audio mocked. Promises.

**Calendar**
- Day, week and agenda views; No Date view; the phone's seven day strip.
- New Event: timed, all day over several days, from a message. Each queues `calendar_outbox`.
- Edit and delete, which queue updates and deletes.
- Tasks: tick off, which queues `task_updates`.

**Contacts**
- List, filters, search; a contact's page (cards, Timeline, Overview).
- Edit, star, split and merge; Merges, Tidy, companies, Team.

**Notes**
- List, new note, editor (checklists, links to conversations and contacts), meeting notes, linked notes on a
  conversation.

**Attachments**
- Grid, filters, viewer (images, PDF first page, audio), hide and show.
- Cloud picks stop at the blocked provider address.

**Settings**
- Every page: Profile, Notifications, Accounts, AI, Drafts, Automations, Team and its views, Usage, Privacy and Data,
  What's New. Search Settings.
- Each connect page works up to the moment it would go to the provider. The firewall blocks that, and the test checks it
  was the right address.
- Notifications: the push permission prompt is mocked; a subscription is saved and removed.

**Owner Only**
- Admin and its tabs, and the Updates editor.
- A normal user is turned away from both.

**Website**
- Home, Pricing, Privacy, Security, Terms, Updates.
- Request Access writes to the test waitlist.
- These run against production too, read only.

**PWA and Speed**
- The service worker installs and stores the app page.
- A second launch shows the stored page and the inbox copy before the network answers.
- Offline launch; coming back online catches up; reopening the app catches up at once.
- Conversations open from prefetch without a load.
- Launch time is measured each run, and the test fails if it gets slower than an agreed budget. This keeps the caching
  work honest.

**Everywhere**
- **Accessibility:** an axe accessibility check on every page (labels, contrast, focus order).
- **Text:** no em or en dashes anywhere, and buttons and headings in Title Case.
- **Console:** no errors on any page.
- **Visual checks:** a screenshot of every page in every screen size, light and dark, compared with the last approved
  one, so a layout break on one phone size is caught. You approve a changed screenshot like any other change.

## How It Runs

- **`pnpm test`:** screen tests with everything else. Every push.
- **`pnpm e2e`:** browser tests on the core three against the test database. On your Mac on demand, and in CI on every
  push to main and every pull request. About 5 to 10 minutes, split across machines.
- **`pnpm e2e:full`:** every screen size, light and dark, with visual checks. Nightly, and before every release
  (`deploy/release.sh` already refuses a commit that CI did not pass).
- **`pnpm e2e:live`:** Phase 6 only. By hand, with a typed confirmation, never in CI.
- **Failures:** each one keeps a trace (a replay of the page, its network and console) to open in the Playwright viewer.

## Build Order

Estimated as Claude-built, with you reviewing.

| Phase | What | Time |
| --- | --- | --- |
| 0 | Done 4 November 2026: see Konva Test Setup below. | Half a day |
| 1 | Done 4 November 2026: see Phase 1 below. | 1 day |
| 2 | Done 4 November 2026: see Phase 2 below. | 1 to 2 days |
| 3 | Incomplete, deferred to the week of 9 November 2026: see Phase 3 below. | 3 to 4 days |
| 4 | All screen sizes, light and dark, visual checks, accessibility and the text rules. | 1 to 2 days |
| 5 | PWA, offline, realtime and the launch time budget. CI jobs and the nightly run. | 1 day |
| 6 | Optional: Live Checks. A real test Gmail and WhatsApp that you own, sending only to each other, started only by you. | 1 day |

After that, every new feature arrives with its screen tests and its browser test, the same way logic arrives with its
unit tests today. This gets added to AGENTS.md.

## Konva Test Setup

Done 4 November 2026 (Phase 0).

- **Project:** "Konva Test", `ammzthqpycofwvxtpyhx`, eu-west-1, Free plan.
- **Schema:** the 201 committed migrations plus `20261124100000_public_company_logos`. That gives 117 tables, every one
  with row-level security on, the five storage buckets, and the two nightly prune jobs. The 20 migrations another session
  had not yet committed (from `20261124100100` on) are not applied; apply them once they are committed.
- **Supabase's auto-RLS event trigger** (`rls_auto_enable`, which production had from its creation) was added by hand
  before the migrations, as the second migration expects it.
- **Settings:** `apps/web/.env.test.local` (gitignored, owner-only file mode). It holds the project address and keys, a
  test-only `KEY_WRAPPING_KEY` (local:v1, never the production key) for the test users' data keys, the same encryption
  flags as production, and the test user.
- **Test user:** `konva-test-user@example.com`, created confirmed through the admin API (no email sent), with a random
  password kept only in that file. Password sign-in and row-level security were checked. The user's data key is made on
  their first sign-in through /api/keys.

**The migrations do not replay cleanly from an empty database.** Production applied them one at a time over weeks, and
three things differ from a fresh run. They were applied here with these adjustments, which give the same end state as
production:
- `20261022203000_junk_unsubscribe` creates `messages_sender_idx`, a name the first migration already used. Production
  never built it (`20261024104000` says so), so index creation was applied as "if not exists".
- `20261025100300_brief_parts_and_voice` runs `delete from public.briefs;` and `20261119150000_document_cards` runs an
  `update public.ai_budget ... ;` without a WHERE. Supabase's API guard refuses both, so they got `where true`, which
  changes nothing.

Any new environment (a staging project, a local Supabase) needs the same adjustments until those migrations are fixed.

**Port 3100 (agreed 4 November 2026).** The browser tests build the app with the test settings into `.next-e2e` and start it
on port 3100 only while they run (`apps/web/e2e/support/serve.ts`). The owner's dev server on 3000 is never touched.

**Brought up to date 4 November 2026** with the migrations committed in v0.0.24: 224 of 225 are applied. The one left,
`20261126100900_require_bound_values`, refuses to run until `SEAL_BOUND_FIELDS` is on, by design.

**Two migrations share a version,** `20261028110700` (`draft_context` and `outbox_voice_notes`). Anything that records
migrations by version (the Supabase CLI, the script used here) applies only the first. `outbox_voice_notes` was applied
to Konva Test by hand. A new environment needs the same, until one of them is renamed.

## Phase 1 (done 4 November 2026)

`pnpm e2e` runs 34 tests on Desktop, iPhone and Android in about 70 seconds, build included.
- **Safety** (`e2e/safety.spec.ts`):
  - settings point only at Konva Test;
  - the server never sees `.env.local`, and the build holds no production reference or secret;
  - the firewall blocks provider requests and websockets, and fails any test that hits an undeclared one;
  - the sign-in code request never reaches the mailer;
  - WebKit runs with service workers blocked;
  - a queued row stays unclaimed (no worker);
  - the seeded data is made up.
- **Seed** (`e2e/support/seed.ts`):
  - the test user's data key, made the way /api/keys makes it;
  - one IMAP account with no stored sign-in;
  - ten conversations (four unread) and 20 messages, written through the real `ingest_email` function, which made 6
    contacts and 3 companies.
- **Flows:**
  - sign in with a password;
  - a wrong password;
  - the inbox lists the conversations;
  - opening one shows its messages and queues its read receipt.
- **Known gaps:**
  - The seed seals as `e1:`; it should switch to `e2:` when bound sealing is turned on.
  - Failure traces in `test-results/` (gitignored) hold the test user's password as typed.

## Phase 2 (done 4 November 2026)

`pnpm test` now runs 272 screen tests over 40 components beside the logic tests; the web tests take about 26 seconds.
- **Setup** (`apps/web/test/`):
  - happy-dom for the page;
  - `tsconfig.test.json` turns on JSX for tests only;
  - a network guard fails any test that tries fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon or Node's
    http, even when the component swallows the error;
  - a fake Supabase client that records calls;
  - a fake store whose every action is a recorded spy;
  - `renderScreen`, which supplies the router, auth and toasts.
- **Covered:**
  - Conversations: composer, list, rows, filters, selection, snooze, Send Later, header, bubbles, reply choices with
    Add to Calendar.
  - Labels.
  - Calendar: New Event including From and Until, delete, new task, month view, week strip.
  - Settings list and search; Summary filter; Your Day.
  - Contacts: list, controls, new, edit, merge.
  - Notes.
  - Attachments filter and delete.
  - New Email and New WhatsApp (Undo Send, Send Later, Cc).
- **Text rules:** no em or en dashes in 24 rendered scenes; Title Case on buttons, menu items and dialog titles.
- **Not covered yet:**
  - week view;
  - editing a repeating event;
  - date picker cells;
  - uploading a reply's files;
  - swipes;
  - By Person and Subscriptions rows;
  - the AI draft panel in New Email.

## Phase 3 (incomplete, deferred to the week of 9 November 2026)

**Status on 5 November 2026.** The owner deferred Phase 3 to the week of 9 November 2026. Part 3a was being built (on
Sonnet) and was stopped part way. Its work is kept as it was left, uncommitted, under `apps/web/e2e/`:
- **Specs:** `actions`, `composer`, `conversations-list`, `new-email`, `phones`, `realtime` and `summary` (new); `inbox`,
  `safety` and `sign-in` (changed).
- **Support:**
  - new: `fake-chats`, `fake-extras`, `fake-incoming`, `reads`, `seal`, `seed-email`, `seed-extras`,
    `seed-whatsapp`, `session`, `time`, `ui`, `users`, `world`;
  - changed: `admin`, `fake-data`, `fake-worker`, `fixtures`, `global-setup`, `seed`, `serve`, `sign-in`.
- **Cache:** `e2e/.cache/` (gitignored by its own `.gitignore`).

It is not finished and not trusted:
- **The last run was failing:** the agent's final note was that it took about 10 minutes with many failures. Treat
  `pnpm e2e` as broken until 3a is finished. The Phase 1 tests may be among the failures, since their support files
  changed.
- **Lint and typecheck pass.** One unused import was removed from `actions.spec.ts` so `pnpm lint` passes for the whole
  repo; nothing else was touched.
- **Not yet checked:** whether the richer seed matches what the workers really write, and whether per-project test users
  work.

**To continue:**
1. Get the existing 3a work passing, Phase 1's tests included.
2. Then finish the rest of the 3a brief below.
3. Then 3b and 3c, one at a time on Sonnet, reviewed and run by the main session.
4. Apply any migrations committed since 4 November to Konva Test first (see Konva Test Setup).

The brief as written on 4 November follows.


Split into three parts run one after another, since they share the test server on port 3100 and the Konva Test data.
Paused by the owner during 3a, before any file was written; nothing to undo. To continue, start 3a again with this brief.

- **3a: data, Conversations and Summary.**
  - **Seed:**
    - Make it richer through the real database functions and the workers' exact sealed formats (apps/worker/src, the
      worker vault's sealAddress and sealName, packages/crypto).
    - Add WhatsApp and group chats; triage fields (Urgent, Needs Reply, junk, summaries, reply choices with a calendar
      plan, one suspicious mail); labels; a draft; snoozed, archived and sent conversations; tasks, events and today's
      brief.
  - **Isolation:** one test user per project (Desktop, iPhone, Android), with passwords kept only in
    `apps/web/.env.test.local`.
  - **Fake worker:**
    - outbox to sent or failed;
    - mail_actions to done;
    - drafts filled;
    - a new incoming message, for realtime.
  - **Conversations tests:**
    - the list: views, filters, By Person, search;
    - read receipts queued;
    - sending: Send, Undo Send, Send Later, a failed send's Retry;
    - a live draft;
    - reply choices with Add to Calendar;
    - labels, snooze, archive, delete and restore;
    - bulk Mark Read, Clean Up, the person view, New Email;
    - tags and the suspicious warning;
    - realtime arrival;
    - offline and back.
  - **Summary tests:** Filter, search, Your Day, the brief player, Promises.
  - **Phones:** list and conversation as separate screens, back navigation, the bottom bar.
- **3b:** Calendar, Contacts, Notes, Attachments.
- **3c:** Settings (every page; the connect pages up to the blocked provider address), Admin and the Updates editor (and
  a normal user turned away), the website and Request Access, invite links, MFA, account deletion on a throwaway user,
  and sign-out clearing local data.

## Decisions for You

1. **Which test database? Decided 3 November 2026: a cloud project.** "Konva Test" (`ammzthqpycofwvxtpyhx`, eu-west-1,
   the same region as production) was created on the Free plan at no cost. On that plan a project idle for a week is
   paused, so the nightly run keeps it awake, and only two projects can be active: the paused Marketing project cannot
   be restored without pausing this one.
2. **Do you want Phase 6, Live Checks?** It is the only way to prove a real send works end to end, using test accounts
   you own and sending only between them, and only when you start it and confirm. Without it, sending is tested up to
   the queue in the browser and by the worker's own tests against fake providers.
