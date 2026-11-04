# Browser and Screen Tests

The plan for testing every page and feature of Konva in a real browser, on every kind of screen, without anything ever
leaving for a real person. Written 3 November 2026. Status: agreed in part; one open decision is at the end.

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
| 0 | Apply every migration to Konva Test, set its keys and settings, and seed a test user. | Half a day |
| 1 | Safety harness first: the production guard, the browser firewall, the fake worker, fixtures and seeding. Then sign in, inbox and one conversation on the core three. | 1 day |
| 2 | Screen tests: the setup and the fake store, then the 40 components that matter most (composer, thread row, filters, dialogs, pickers, calendar grid). | 1 to 2 days |
| 3 | Browser tests for every area in the list above, on the core three. | 3 to 4 days |
| 4 | All screen sizes, light and dark, visual checks, accessibility and the text rules. | 1 to 2 days |
| 5 | PWA, offline, realtime and the launch time budget. CI jobs and the nightly run. | 1 day |
| 6 | Optional: Live Checks. A real test Gmail and WhatsApp that you own, sending only to each other, started only by you. | 1 day |

After that, every new feature arrives with its screen tests and its browser test, the same way logic arrives with its
unit tests today. This gets added to AGENTS.md.

## Decisions for You

1. **Which test database? Decided 3 November 2026: a cloud project.** "Konva Test" (`ammzthqpycofwvxtpyhx`, eu-west-1,
   the same region as production) was created on the Free plan at no cost. On that plan a project idle for a week is
   paused, so the nightly run keeps it awake, and only two projects can be active: the paused Marketing project cannot
   be restored without pausing this one.
2. **Do you want Phase 6, Live Checks?** It is the only way to prove a real send works end to end, using test accounts
   you own and sending only between them, and only when you start it and confirm. Without it, sending is tested up to
   the queue in the browser and by the worker's own tests against fake providers.
