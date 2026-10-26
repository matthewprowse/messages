# Product Plan

What we have agreed on so far: who Messages is for, what is in the MVP, how the key features work and
what comes later. Update this file whenever a decision changes.

The product is called Konva (decided 24 October 2026). The code and this plan still say Messages.

## Who It Is For

Anyone anywhere can sign up, but marketing targets South African professionals whose income depends
on replying to clients quickly:

1. Estate agents (first)
2. Insurance brokers and financial advisers
3. Attorneys
4. Recruiters

Their clients reach them on WhatsApp, email and Instagram at once. Kinso sorts messages by channel for
busy founders. Messages sorts them by client for professionals who cannot afford to lose one.

Positioning lines to test:

- Every client conversation, in one place.
- Never lose a client on WhatsApp again.
- Your clients message you everywhere. Answer them in one place.

## Business Model

- Individual: R349 a month. Team seat: R499 a month. Prices exclude VAT (register once turnover
  passes R1M in 12 months).
- Sell whole agencies, practices and brokerages, not only single seats. The owner keeps the client
  history when an agent leaves.
- Ideal customer (26 October 2026): a business in any industry where speed of response wins work,
  onboarding 5 to 25 team members at once. Individual sign-ups are the side door, not the plan.
- Goal: more than R1M a month in profit within 12 months. That needs about 3,800 paying users by
  month 12. At the researched cost of getting a user (about R1,200), that takes over R5M of marketing
  in the year unless agency deals bring most users, so treat it as a stretch, not the base case.

### Revenue Estimates (October 2026)

Ranges from a simulation over the inputs below (20,000 runs). P50 is the middle outcome; P10 and P90
are the bad and good ends. Figures run from the month paid marketing starts, exclude VAT and exclude
any salary.

| Input | Low | Middle | High | Source |
| --- | --- | --- | --- | --- |
| Meta cost per click | R3.50 | R6 | R10 | Superads benchmarks: South Africa about $0.22, real estate about $0.35, at about R16.50 to the dollar |
| Clicks that start a trial | 1.5% | 4% | 8% | Typical B2B landing pages, lower because accounts must be connected |
| Trials that pay (no card asked) | 6% | 12% | 20% | First Page Sage 18% for no-card trials, ChartMogul median 8% |
| So, cost per paying user from ads | about R690 | about R1,190 | about R2,170 | Worked out from the three rows above |
| Average income per user | R330 | R390 | R430 | R349 and R499 plans, some annual discounts |
| Cost to run a user | R45 | R70 | R120 | Gemini, hosting, card fees, support |
| Paying users cancelling each month | 3% | 5% | 8% | SMB SaaS benchmarks 3% to 7% |
| Users from your own selling each month | 5 | 15 | 30 | Assumption |
| Referrals each month, share of users | 1% | 3% | 5% | Assumption |
| Seats from agency deals each month, from month 4 | 0 | 10 | 30 | Assumption |
| Fixed costs | R11k a month, R65k once, plus R15k a month from month 6 for KMS and Confidential Space | | | |

With R495k of marketing in the year:

| After 12 months | P10 | P50 | P90 |
| --- | --- | --- | --- |
| Paying users | 460 | 660 | 960 |
| Monthly revenue in month 12 | R175k | R253k | R368k |
| Revenue in the year | R0.90M | R1.29M | R1.84M |
| Profit in the year | -R86k | R224k | R681k |
| Profit in month 12 | R45k | R104k | R194k |
| Most cash needed at any point | R188k | R130k | R108k |
| First profitable month | 4 | 5 | 9 |

With R1.32M of marketing in the year:

| After 12 months | P10 | P50 | P90 |
| --- | --- | --- | --- |
| Paying users | 830 | 1,310 | 2,090 |
| Monthly revenue in month 12 | R317k | R500k | R802k |
| Revenue in the year | R1.43M | R2.19M | R3.42M |
| Profit in the year | -R501k | R116k | R1.12M |
| Profit in month 12 | R7k | R146k | R373k |
| Most cash needed at any point | R510k | R224k | R126k |
| First profitable month | 5 | 8 | 12 |

Market size in South Africa: about 50,000 property practitioner certificates (PPRA renewal cycle),
about 35,000 practising attorneys (LPC and LSSA), about 168,000 appointed FAIS representatives
(implied by the FSCA's 1,679 debarments being about 1% of them, most tied to banks and insurers),
and about 4,500 to 5,400 recruitment businesses. If 5% to 10% of the independent professionals among
them pay, that is roughly 5,000 to 10,000 users, or R2M to R4M a month in revenue at full maturity.

The three numbers that decide which column we land in are cost per click, clicks that start a
trial, and trials that pay. The first R10k to R15k of ads measures all three. Rerun the model with
the real figures then.

### Five-Year Estimates (October 2026)

Same inputs and 20,000 runs, carried to 60 months, with R50k of starting cash. Ads are paid only
from cash on hand (half of what is free above a R15k buffer). Added: 6% price rise each year, a
market of 5,000 to 12,000 South African payers that gets dearer to reach as it fills, a R25k to
R30k support or sales hire for each 700 users after the first 400, and the yearly Google security
assessment. Fixed costs start lean (R4k a month, R25k once) and rise to R11k at 150 users and add
KMS and Confidential Space at 300. Excludes VAT, tax and the founder's salary. South Africa only.

Bootstrapped on R50k, middle outcome (P10 to P90 in brackets):

| Year | Paying users at year end | Revenue in the year | Profit in the year |
| --- | --- | --- | --- |
| 1 | 470 (320 to 670) | R0.96M (R0.6M to R1.4M) | R0.3M (R0.15M to R0.5M) |
| 2 | 1,080 (760 to 1,510) | R4.0M (R2.8M to R5.7M) | R2.0M (R1.0M to R3.2M) |
| 3 | 1,590 (1,110 to 2,220) | R7.1M (R4.9M to R10.0M) | R4.1M (R2.6M to R6.2M) |
| 4 | 2,020 (1,400 to 2,830) | R10.1M (R7.0M to R14.2M) | R6.1M (R3.9M to R9.3M) |
| 5 | 2,410 (1,670 to 3,370) | R13.1M (R9.0M to R18.4M) | R8.3M (R5.2M to R12.3M) |

With R1.5M raised in month 12 (spent on ads, a R50k founder salary and one salesperson), year 5
revenue is about R24.7M (R17.6M to R34.1M) with about 4,500 users, and about half of the runs average
R1M a month in profit in year 5. Bootstrapped, 12% do. None reach it in the first 3 years either way.

If own selling, agency deals and referrals come in at about a third of the plan's figures, the
bootstrapped year 5 falls to about R8.0M revenue and 1,500 users, and year 1 to about R0.3M.

What this shows: the R50k is enough because the plan's own selling and agency deals bring most early
users for free, so those two numbers matter more than the ad budget. The ceiling is the South
African market, not cash; a raise roughly doubles the outcome, and a bigger raise adds little unless
it pays for selling outside South Africa. The model assumes the product sells and WhatsApp keeps
working; it does not price in a Baileys ban wave or a Google verification delay.

### UK and US (October 2026)

Working assumptions, not yet tested: UK at £29 individual and £39 a seat, US at $39 and $49 (about
R700 a user either way, at R22 to the pound and R16.50 to the dollar). Meta clicks cost about R20 in
the UK and R23 in the US, against R6 here, and trials convert a little worse (no local references).
That puts the cost of a paying user at about R5,000 to R6,000, so ads take about 8 months to pay back,
against about 3 in South Africa. There is no own selling abroad and few agency deals. Payments go
through a merchant of record (about 6%), which handles UK VAT and US sales tax.

| Bootstrapped on R50k, middle outcome | Year 5 revenue | 5-year revenue | Year 5 users (SA / UK / US) | Year 5 runs averaging R1M+ profit a month |
| --- | --- | --- | --- | --- |
| South Africa only | R13.0M | R35M | 2,410 / 0 / 0 | 12% |
| UK from month 13 | R16.4M | R42M | 2,350 / 390 / 0 | 33% |
| UK from month 13, US from month 25 | R18.7M | R46M | 2,410 / 400 / 200 | 45% |
| All three from month 1 | R20.0M | R50M | 2,400 / 450 / 280 | 54% |
| R1.5M raised in month 12, UK month 13, US month 25 | R40.1M | R98M | 4,470 / 1,030 / 570 | 85% |

All three from month 1 looks best on paper, but every run runs out of cash in the first months
(about R40k short), year 1 profit halves, and it needs support across three time zones on part-time
hours. The order: South Africa first, the UK once South Africa has 300 to 500 paying users, the US
only with funding or a WhatsApp-heavy niche.

- UK: WhatsApp is used for clients, English, close time zone, and FCA record-keeping rules make the
  client archive easy to sell to advisers and mortgage brokers. Host in a UK or EU region for UK GDPR.
- US: most clients text by SMS or iMessage, which Konva cannot read, so target WhatsApp-heavy niches
  (agents serving Latino and international buyers, immigration attorneys, international recruiters).
- Regulated buyers abroad (advisers, brokers) will expect the official WhatsApp Business API rather
  than Baileys, and they already have archiving vendors to choose from.
- Run a small UK ad test (R5k to R10k to a waitlist) alongside the South African one to measure UK
  click costs and sign-ups before committing.

South Africa and the UK only, UK from month 13, middle outcome:

| Year | Bootstrapped revenue | Bootstrapped profit | Users (SA / UK) | With R1.5M in month 12: revenue | Profit | Users (SA / UK) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | R0.96M | R0.3M | 470 / 0 | R1.0M | R0.14M | 570 / 0 |
| 2 | R4.3M | R1.9M | 1,060 / 80 | R8.4M | R1.4M | 2,080 / 240 |
| 3 | R8.2M | R4.6M | 1,550 / 170 | R17.5M | R7.3M | 3,080 / 480 |
| 4 | R12.2M | R7.3M | 1,970 / 280 | R25.7M | R12.5M | 3,790 / 730 |
| 5 | R16.4M | R10.3M | 2,350 / 390 | R33.6M | R17.6M | 4,360 / 990 |

When the UK starts barely matters while it grows only from ads (5-year revenue is R42M to R43M
whether it starts in month 1, 7 or 13), so start it once South Africa runs smoothly. Leaving out the
US costs about R2M of year 5 revenue bootstrapped and about R6M funded.

### Launch Model: South Africa, Team Deals First (October 2026)

Decided 26 October 2026: launch in South Africa only (a UK user costs about 4 to 8 times as much to
win, per the UK figures above), sell mainly to businesses that onboard 5 to 25 seats at once, and keep
individual sign-ups from ads as a side channel. Plan: R75k over the first 4 months, paying costs first
and the rest on individual ads (up to R30k a month); the first Google check is paid before launch.
Interactive model with sliders and sources: https://claude.ai/artifact/3uKxGHoQezWJcaTK9uavc5

Team inputs and their sources: demos a month (yours: 4 to 16); demos that close (18.7% median across
B2B demos, 32% for small-business demos, 40% top performers; Visionary Marketing, Fungies); seats per
new business (yours: 5 to 20); businesses cancelling (0.9% to 1.8% a month, from 80% to 90% yearly
gross retention for small-business SaaS; StealthAgents, SaaS Capital); seat growth in businesses that
stay (0% to 20% a year; Aleph and Benchmarkit, Statisfy); an optional salesperson at about 27 demos a
month (Crunchbase) and R18k to R46k a month (Paylab SA). Individual inputs are the sourced ad, trial
and churn figures from before. Support staff and rising click costs are included. Demo close rates,
cancellations and seat growth move together with the ad numbers at 50% (an estimate).

The model runs 1,000 random mixes of the ranges and shows the runs at the 10th, 50th and 90th place
by revenue. Monthly revenue (P10 / P50 / P90):

| | You alone, 8 demos a month | With a salesperson from month 6 |
| --- | --- | --- |
| Month 12 | R131k / R212k / R344k | R279k / R415k / R673k |
| Month 24 | R264k / R412k / R676k | R708k / R1.10M / R1.68M |
| Month 36 | R359k / R572k / R948k | R1.02M / R1.67M / R2.54M |
| Month 60 | R539k / R869k / R1.48M | R1.58M / R2.59M / R4.28M |

Team deals bring 80% to 95% of revenue in most runs. With a salesperson from month 6, the middle run
reaches about R1M a month in profit around month 36 (excluding your salary and tax). What the model
assumes and cannot check: that you can fill 8 qualified demos a month (finding people to demo to is
not costed), that a new product closes like established ones, and that businesses accept WhatsApp
through Baileys. Your first 10 to 20 demos give a real close rate and seats per business.

## Marketing Page

The marketing page lives at `/` in the web app (`apps/web/app/page.tsx`) and is public. A first
build was cleared on 24 October 2026, so the page is blank for now and is to be rebuilt.

Recommended sections, in order, each modelled on a Mobbin reference:

1. Nav: Features, Privacy, Pricing, FAQ, Sign In, Start Free Trial.
2. Hero (Notion Mail): "Every client conversation, in one place." with the inbox mock-up.
3. Works With (Lattice): WhatsApp, Gmail, iCloud Mail, Google Calendar, plus a Coming Soon row.
4. Client timeline (OpenPhone): one client's email, WhatsApp, voice note and viewing together.
5. Features (Front): Needs Reply, drafts in your voice, voice notes, the spoken brief.
6. Privacy (Campsite): only claims that are true today.
7. Pricing (Cursor): Individual R349, Team R499 a seat marked Coming Soon. Prices exclude VAT.
8. FAQ (Zendesk): includes plainly that WhatsApp is an unofficial connection.
9. Final call to action, then a small footer.

Still to do before it goes live:

- Sign up is built (see Onboarding): `/login` now creates an account too, with Google or an emailed code.
  Start Free Trial can keep pointing there.
- Privacy Policy and Terms pages, linked from the footer. Google verification for Gmail needs both.
- The trial length, and real brand logos in Works With.
- Check the copy against what is built on launch day: the client timeline is still To Do, and the
  privacy claims must stay within Where It Stands below.

## MVP

| Area | What | Status |
| --- | --- | --- |
| Mail | iCloud+ (IMAP and SMTP), Gmail | Built |
| Mail | Microsoft 365 and Outlook through Microsoft Graph (see apps/worker/README.md) | Built, not yet checked on a real account |
| Calendar | Google Calendar | Built |
| Calendar | Outlook Calendar through Microsoft Graph, read only | Built, not yet checked on a real account |
| Calendar | iCloud Calendar through CalDAV, read and create events | Reading checked against a real account. Creating is unit tested only: no event has been made on a real calendar yet |
| Calendar | Apple Calendar (CalDAV, app-specific password) | To do |
| WhatsApp | Personal and WhatsApp Business app numbers through Baileys | Built |
| WhatsApp | Voice notes transcribed and summarised by Gemini (see below) | Built |
| Mail | Any other IMAP and SMTP mailbox (Afrihost, Xneelo, Domains.co.za, cPanel hosts, Yahoo and others), with server settings found automatically. iCloud becomes one preset of the same connector | Building (agreed 26 October 2026) |
| Meetings | Google Meet, Teams and Zoom transcripts, shown as a card in the attendee's conversation, on their contact page and on the calendar event (see Meeting Transcripts below) | Building |
| Meetings | Teams, Zoom and Google Chat conversations, read and reply, including the chat inside a meeting (see below) | Building |
| Social | LinkedIn messages through the open-source linkedin-api Python library (see Social Messaging below) | Building (agreed 26 October 2026) |
| Social | Instagram DMs through the open-source instagrapi Python library, personal and business accounts | Building (agreed 26 October 2026) |
| Tasks | Microsoft To Do, Google Tasks and iCloud Reminders, shown in Calendar on the day they are due and in the daily brief, ticked off from the app | Building (agreed 26 October 2026) |
| Privacy | Per-user encryption of stored data | In progress |
| Email display | Bold, italics and the like in email and WhatsApp bubbles (see below) | Built, not yet checked on real mail |
| Drafts | Guided drafting, What To Say (typed or spoken), Adjust, Edit Text, saved facts, follow-ups, drafting new emails and WhatsApp messages (see below) | Built; checked offline against 35 real replies and end to end on real conversations, not yet in the browser |
| Brief | Spoken daily brief (see below) | Built |
| Contacts | Rename a contact and edit their company, role, relationship, addresses and numbers. A name set by hand is kept when the address book or WhatsApp name changes | Built |
| Media | Voice notes and audio play inside the conversation (speed 1x, 1.5x, 2x); videos play in the app's own player | Built |
| Notes | Private notes with live markdown formatting and attachments, under Attachments in the rail (see below) | Built, not yet checked in the browser |
| Clients | Client timeline across every channel | To do |
| Leads | Property24 and Private Property enquiry emails turned into clients | To do |
| Onboarding | Sign up, a setup dialog over the app (connect, about you, what Konva found, contacts, a practice reply) and a page by page tour (see below) | Built on mock data for the findings, contacts and drafts; not yet checked end to end with a new account |

## How the Key Features Work

### Client Timeline

Each client is one timeline: their WhatsApp chats, emails, voice notes and meetings together, with a
deal, listing, policy or matter attached. Opening "Mrs Naidoo" shows everything. This is what keeps
people from leaving, because their client history lives here.

### Guided Drafting

When a message needs a decision the AI cannot know, the AI does not guess. It offers two to four
one-tap choices and drafts only after the user picks one.

- "Are you available on Thursday at 3?" shows Yes, No and Suggest Another Time. Suggest Another Time
  reads the calendar and offers free slots to tap.
- "Can you send the documents?" shows Sending Now, Tomorrow and Which Documents.
- A price, offer or yes or no question shows the matching answers, plus a field to type what to say.

The chosen option and any typed note go into the prompt, so the draft says what the user decided in
their own voice. Choices picked again and again become learning signals, like the existing tones
(Shorter, More Formal, More Casual).

How it is built:

- Triage already reads every incoming email and WhatsApp message (except bulk senders the model has
  labelled the same junk way in its last 3 answers, which are skipped and rechecked every 14 days;
  on the first 1,409 emails that skips 44% of calls, and the model disagreed on 2 of those). In the
  same model call it returns
  the choices, the time asked about and how long it would take. They are stored encrypted in
  message_ai.reply_choices. Messages triaged before this get theirs when triage has nothing new to
  do, while they still need a reply.
- The buttons sit above the reply box, in the outline style of the tone buttons, only while the
  latest message is someone else's and no draft is open. Draft Reply stays for anything else.
- An availability question is checked against the calendar ("Your calendar is free on Thursday 29
  October, 15:00", or what is on then). Suggest Another Time offers up to three free whole hours
  between 08:00 and 17:00 over the next week, at most two a day.
- The pick is stored on the draft (drafts.decision, encrypted, and drafts.decision_kind) and kept
  when the user asks for another tone or regenerates.
- Repeated picks become style rules: the learner reads what was picked, what was decided and what
  was finally sent, and writes rules only for patterns that repeat, such as how the user confirms a
  time or turns something down.

### Pre-Drafting

Decided 26 October 2026. A draft is written before it is asked for, so it is already in the reply box
when the user opens the conversation. Asking for one takes about 4 seconds; most of that is the model.

When a draft is written:

- While the app is open and in view: about 30 seconds after the last change to a conversation (so a
  burst of WhatsApp messages gets one draft), once triage has read it.
- When the user opens a conversation that qualifies and has no draft yet.
- Never while the app is closed. Most replies are still sent from the phone or Gmail (on the owner's
  account 28 of 164 replies in two weeks went through the app), so drafts written then would mostly
  go unseen.

Which conversations qualify:

- One to one (not a group), the latest message is someone else's and is under 7 days old.
- Triaged as personal, work or needs reply, and not junk. Newsletters and notifications are skipped.
  Triage's needs reply flag alone is too strict: it missed 8 of the 15 WhatsApp chats and all 7 email
  conversations the owner replied to in two weeks.
- Skipped when the latest message has guided drafting choices, as the draft would have to decide for
  the user. Picking a choice drafts as before.
- Skipped when a draft was already asked for, discarded or written since the latest message.
- At most 30 a day per user (written by the model in the last 24 hours). After that, drafts are asked
  for as before.
- Settings, Auto-Draft Replies turns it off (profiles.auto_draft_top, on by default).

How it is built:

- The app calls public.request_auto_draft(thread), which checks all of the above and adds a pending
  draft marked auto with the message it answers (drafts.auto, drafts.for_message_id). One per message,
  so two open devices make one draft.
- The AI worker writes auto drafts after the ones people asked for, and drops one whose message is no
  longer the latest or that has choices, without calling the model.
- A pre-draft that goes stale (a newer message, a reply sent from anywhere, or a newer draft) becomes
  expired, not discarded, so learning never treats a draft the user did not see as one they threw away.
- A pre-draft never replaces text the user is typing.
- Analytics: draft_requested with source auto, and auto on draft_shown, draft_sent and draft_discarded,
  so /analytics shows how many pre-drafts are sent as they are, edited, discarded or never used.

Cost: a draft averages 1,116 tokens in and 73 out, about R0.018 now and R0.035 from 1 January 2027,
when Gemini 3.8 Flash doubles in price. The owner's volume would be about 300 a month if every
qualifying message were drafted (R5 now, R11 from January); the cap holds a busy user to R32 a month
at January prices, and drafting only while the app is open should be well under that. All AI use is
about R39 a month on the owner's account now and doubles in January, above the R70 cost to run a user
before hosting and card fees, so that estimate needs revisiting either way.

### Editing Your Own Text

When the reply box holds text the user wrote, or an AI draft they changed, Edit Text sends it to the
AI for light correction instead of a new draft: spelling, grammar, punctuation and phrasing that is
wrong or hard to follow. Their words, sentence order, line breaks, length, greeting, sign-off and
level of formality stay; nothing is added or dropped; text that is fine comes back unchanged.
Afrikaans, isiZulu, mixed languages and slang (ja, lekker, now now) are never "corrected".

- Built on drafts: a draft with tone 'edit' carries the text in drafts.source (encrypted as a draft
  body). The worker uses the same prompt as a draft (voice, this person, the conversation, so names
  are spelled right) ending with the text to correct, at a low temperature.
- Runs on the fast model (flash-lite) with medium thinking: 2 to 5s, where the full model took 2 to
  17s. On low thinking flash-lite let every typo in an all-lowercase message through.
- Straight quotes stay straight unless the user typed curly ones.
- On 5 sample replies the edits kept 90 to 99% of the text the same.

### Drafting Overhaul (October 2026)

Four analyses (code audit, cost, latency, and an offline check of drafts against 35 replies the user
really sent) found that drafts are fast enough (about 5s) and cheap (about $0.001 each), but the first
draft was almost never sent: 0 of 23 single-draft requests, and every send took 4 to 7 attempts. The
check showed why: in 20 of 35 replies the right answer depended on something only the user knew.
Given an 8-word instruction, sendable drafts in those went from 3 of 20 to 15 of 20. So the composer
now asks first.

The reply box:

- What To Say: a line above the reply box, there before any draft, typed or spoken. Draft (or Draft
  Follow-Up when the user wrote last) writes from it; empty, it drafts on its own. The instruction
  stays with the draft, so Redraft and Adjust keep it (they used to drop it).
- Speak (the waveform button): say what the reply should say. The clip is sealed with the user's key
  (FIELD voice_instruction), uploaded to attachments/<user>/drafts/, heard in the same model call
  that writes the draft, and deleted. What was said becomes the draft's instruction.
- Adjust menu (Shorter, More Formal, More Casual) replaces the three tone buttons, which were used for
  1 of 66 drafts. It changes the text in the box, the user's edits included, keeping every fact, on
  the fast model in about 1s, instead of writing a new draft.
- Undo after any draft, edit or adjustment that replaced text in the box. Text typed in a
  conversation is kept when the user moves to another and back (for as long as the app is open).
- Edit Text stays as its own button.

Drafts themselves:

- Channel-aware prompt: WhatsApp drafts are chat messages (no greeting line or sign-off unless the
  user writes them on WhatsApp), email drafts are emails; the user's own messages in the conversation
  decide greeting and register; replies match the conversation's language. Voice examples come from
  the same channel only. Offline: email style on WhatsApp 4 times to 0, formality right 30 to 35 of 35.
- Group chats name every sender; attachments, photos and quoted messages are shown in the
  conversation; when the user wrote last, the draft is a follow-up, not a reply to themselves.
- Saved facts: a note marked Use in Drafts (note menu) goes into every draft's prompt (up to 15
  notes, 6,000 characters) for fees, checklists and addresses, quoted exactly.
- A draft that was edited or adjusted is 'revised', not 'discarded', so learning no longer reads it
  as thrown away.

New messages:

- New Email and New WhatsApp have the same What To Say line (typed or spoken), Edit Text and Undo. An
  email draft fills the Subject too. The draft has no conversation (drafts.thread_id null, account_id
  and contact_id set, the contact found from the first address or the number); the worker reads
  public.compose_context, the same parts as a reply without the conversation, and refuses a request
  with nothing to say. The draft's id goes out with the message (outbox.draft_id), and learning reads
  it once the conversation is filed. A draft left unsent when the dialog closes is thrown away.

Waiting on them:

- When the user wrote last in a one-to-one conversation more than a day ago, the AI worker reads that
  message once (full model: the fast one missed sent documents and proposed times) and stores whether
  it expects an answer in follow_ups. The Waiting filter in All lists those unanswered for 2 days;
  Draft Follow-Up writes the nudge.

Speed:

- The worker warms the Gemini connection while it reads the context (about 0.6s saved on a cold
  start), a model call with no answer after 4.5s is raced by a second one (8 to 10s calls were seen
  against a usual 2.6s), and the app shows a draft it is waiting for the moment it arrives.
- Not done, by measurement: streaming (replies are short, it would save 0.2 to 0.6s), explicit
  Gemini caching (the prompt is under the 1,024-token minimum), prompt trimming (under 0.1s).

Not built yet:

- Draft versions (back and forward through earlier drafts) and showing what an edit changed.
- Style rules tagged by channel (all 11 learned rules are email rules), and a profile "about" that
  matches the user's real mail: both hurt drafts in the offline check.
- Waking the worker from Realtime instead of polling (about 0.75s), and running it next to the
  database (about 0.7s), with the planned Confidential Space move.

### Spoken Daily Brief

Every morning: today's meetings and viewings, clients waiting on a reply, and anything urgent. It can
be read on screen or listened to in the car, using Gemini to speak it. It builds a daily habit and is
the main reason to open the app on the move.

How it is built:

- The AI worker writes one brief a day at the user's briefing time (07:00 by default) in their time
  zone, which the app keeps in step with their device. It runs in its own thread.
- The script comes from the same labels as the Summary page (needs a reply, urgent or important,
  updates from the last day, with each conversation's one-line summary) and today's calendar. No
  message bodies are read. It is 120 to 220 words, written to be heard, with times said naturally.
- Gemini 3.8 Flash TTS reads it aloud. About a minute of audio costs about $0.02, and speech is
  about 93% of what a brief costs, so the morning brief is written as a script only and spoken
  when someone presses Listen (status written, then speak_pending set by the app). A brief asked
  for in the app is written and spoken at once. The speech model is sent the script alone: style
  directions in its prompt were sometimes read aloud, and it does not take a system instruction.
- The audio is spoken in parts at sentence ends: a short first part on its own, then the rest at
  once, each stored as it is ready. A new brief starts playing about 12 seconds after it is asked
  for, and a ready one in about 2 seconds.
- The script and the audio are stored encrypted (briefs, brief_parts) and deleted after 7 days.
- On the Summary page, Listen plays it, writing a fresh one first when there is none, the voice
  changed, or conversations moved on since it was written more than an hour ago. The script shows
  while it plays, and the phone's lock screen gets play and pause. Refresh writes a new one.
- Settings, Notifications, Daily Brief: the time, the voice (six, each with a sample in
  apps/web/public/voices) and the playback speed (1.15x by default; the voice's own pace is slow).
- It speaks to the user as "you" and never says their name except in the greeting.
- Still to do: a smaller audio format than WAV (about 3MB a minute).

### Email Display

The AI does not rewrite emails for layout. It is slow, costs money per email and can change wording.

1. Conversation emails (a person writing to a person): convert the HTML to a small set of
   formatting (bold, italics, links, lists, line breaks), remove quoted replies and signatures, and
   show it in the chat bubble, like WhatsApp formatting.
2. Marketing and notification emails (GitHub, newsletters, receipts): show the original HTML in a
   sandboxed frame with a one-line AI summary above it.

Test on 30 or more real emails, marketing ones especially, in the browser before calling it done.

How formatting is built:

- Email HTML is no longer stored (see Privacy and Encryption), so when an email arrives the worker
  notes which phrases its HTML made bold, italic, underlined, struck through or code. That list is
  stored encrypted in messages.body_marks. The app finds those phrases again in the bubble text and
  draws them. No sender HTML ever reaches the page.
- Emails stored before this got their list from their HTML in the same pass that cleared it
  (pnpm drop-stored-html, run on 23 October 2026: 1,077 emails, 1,015 kept formatting).
- WhatsApp text is kept as sent and drawn the way WhatsApp draws it: *bold*, _italic_,
  ~strikethrough~, `code` and ```monospace```, quote lines and bulleted lists.

### Voice Notes

Baileys downloads the audio and Gemini transcribes it, so there is still one AI provider. The
transcript is searchable and summarised in the timeline. Test with South African accents, Afrikaans
and mixed-language notes.

How it is built:

- The AI worker's transcribe job (apps/ai/ai/transcribe.py) checks every 5 seconds for voice notes
  the sync worker has saved. It sends each one to Gemini 3.8 Flash once, asking for exactly what was
  said, in the language it was said in (no translating). A minute of audio costs about $0.002.
- What was said is stored encrypted in messages.transcript (field "transcript").
  messages.transcript_status is 'done', 'silent' when nothing could be made out, or 'failed' after
  three tries.
- In the app, a voice note in a chat has View Transcript under the player, which opens the text in
  the bubble. A transcript that arrives while the chat is open appears without a reload.
- Triage holds a voice note back for up to 15 minutes until its transcript is ready, then reads the
  transcript as the message. So the conversation's summary, needs reply, the one-tap choices and the
  daily brief know what was said, and a voice note that matters shows up in the brief.
- Drafting reads the transcripts in the conversation, so a reply answers what was said.
- A voice note that was triaged before its transcript existed is triaged again once it is
  transcribed, if it is within triage's 30-day window.
- Usage is filed as "Voice Note Transcripts" in Settings, Usage.
- Only voice notes are transcribed, not other audio files people send.

Sending voice notes (built 26 October 2026):

- WhatsApp reply box only: a microphone button next to the paperclip. While recording, the text box
  becomes "Recording" with the time, and Cancel and Stop take the Send button's place. Stop adds the
  note to the reply's files as a chip you can play, scrub and remove; Send via WhatsApp sends it with
  any text and files, each as its own message. Notes under 1 second are dropped, as WhatsApp does.
- The browser records Ogg or WebM Opus (MP4 in older Safari). It uploads like any outbox file, with
  outbox_attachments.voice_note = true (only allowed on audio).
- The sync worker converts it with ffmpeg (apps/worker/src/whatsapp/voice-note.ts) to mono 48 kHz Opus
  at 32 kbps in Ogg, works out its length and the 64-bar waveform, and sends it with ptt set, so it
  arrives as a voice note rather than an audio file. Sent notes are stored and transcribed like
  received ones.
- ffmpeg is a system binary, not an npm package: the worker's container image needs it when the worker
  moves to Confidential Space.

### Meeting Apps: Chats and Replies

Teams and Zoom are where some clients talk between meetings, not only during them. Bring in
their conversations as well as the transcripts, so they sit in the client timeline next to WhatsApp
and email, and let the user reply to those people from Konva. Triage, the brief and guided drafting
treat them like any other conversation.

| App | Read | Send | Notes |
| --- | --- | --- | --- |
| Teams | Chats and meeting chats through Microsoft Graph (Chat.Read) | ChatMessage.Send, as the user | Same Microsoft sign-in as Outlook and Outlook Calendar. A Teams meeting's chat is an ordinary chat thread, so it comes in with the rest |
| Zoom | Team Chat API for ongoing chats. In-meeting chat comes from the cloud recording's chat file | Team Chat API, as the user | In-meeting chat is only kept when the meeting is cloud recorded, which needs a paid Zoom plan |

Google Meet's own chat disappears when the call ends and the Meet API does not return it, so Google's
equivalent of Teams chat is Google Chat. Decided 26 October 2026: bring in Google Chat with Meet. Both
need a Google Workspace account; personal Gmail has neither Meet transcripts nor the Chat API.

How it fits together:

- Meeting participants are matched to contacts by email address, the same way email is, so a Teams
  chat with someone already on WhatsApp joins their existing client record.
- A reply goes back through the app the conversation came from. If that is not possible (for
  example the person is outside the user's organisation and Teams or Zoom blocks outside chats),
  offer the client's other channels: email or WhatsApp.
- Sending follows the same rules as email and WhatsApp: the user always sees and taps Send.
- Message text is encrypted per user like every other message (see Privacy and Encryption).

Teams, Zoom and Google Meet with Google Chat are being built in parallel from 26 October 2026, each
by its own agent, then merged. Testing on real accounts comes after, and needs a Microsoft 365 tenant,
a paid Zoom plan with cloud recording and a Google Workspace account with transcription.

### Meeting Transcripts

Decided 26 October 2026. A meeting is stored once, with its transcript, an AI summary and action
items, and shows in three places:

- As a card in the conversation of each attendee who is a contact, placed by time among the messages.
  The card shows the platform, title, time and length, the summary and the action items. View
  Transcript opens the full transcript by speaker, with search.
- In a Meetings section on the contact page.
- On the meeting's calendar event, matched by its join link, or by time and attendees.

Transcripts come from the platform when transcription was on. When there is only a recording (Zoom
audio), the AI worker transcribes it with Gemini, the way it does WhatsApp voice notes. Attendees are
matched to contacts by email address. The transcript, summary and action items are encrypted per user.

### Social Messaging

Decided 26 October 2026: LinkedIn and Instagram connect through open-source Python libraries, the way
WhatsApp connects through Baileys, rather than a paid service. Unipile was priced at about 4.50 to 5
euro per linked account each month (about R160 to R200 for a user with both), too much against a
South African subscription.

| App | Library | Signs in as | Notes |
| --- | --- | --- | --- |
| LinkedIn | linkedin-api (LinkedIn's internal Voyager API) | The LinkedIn website | No official API exists for direct messages. A CAPTCHA at sign-in cannot be solved for the user, so the fallback is pasting the browser's session cookies |
| Instagram | instagrapi (Instagram's private mobile API) | The Instagram app | Works for personal accounts, which the official API does not. The session and device are kept, so later runs never sign in again |

How they run: as their own Python processes beside the AI worker, storing conversations in the same
tables as WhatsApp. They poll every few minutes with jitter, never mark chats as read unless the user
reads them in Konva, never send without the user tapping Send, and stop at the first sign of a
restriction until the user reconnects. Both can route through a proxy, since server IPs are flagged.

### Tasks and Reminders

Decided 26 October 2026. Microsoft To Do (Tasks.ReadWrite, same Microsoft sign-in), Google Tasks (the
tasks scope, same Google sign-in) and iCloud Reminders sync into one tasks table:

- Calendar shows each task on its due day: all-day ones in the all-day row, timed ones at their time,
  overdue ones on today. A tick completes it at the source.
- The daily brief reads out what is due today and what is overdue.
- iCloud Reminders is the hard one: Reminders lists upgraded since iOS 13 are no longer served over
  CalDAV. The agent building it chooses between CalDAV, iCloud's web endpoints and a small Mac relay,
  and records why.

### Notes

A place to write things down next to the conversations: call notes, to-do lists, quotes to send.
Agreed 25 October 2026.

- **Where:** Notes sits in the rail directly under Attachments. The page is laid out like
  Conversations: the list on the left third, the open note on the right two thirds, and on phones the
  list fills the screen and a note opens full screen with a Back button.
- **List:** the "Notes" title, then a Search Notes field where the Conversations views are and a
  New Note button (secondary) where the filter is. Rows show the title, the time it was edited and
  the first line of text. Pinned notes come first, then the most recently edited. Pin and Delete are
  on hover and right-click; Delete asks first.
- **Note:** the same header as a conversation and the same 672px column, so text lines up where chat
  bubbles do. A title field, then the editor. A toolbar under the header: bold, italic, strikethrough,
  inline code, headings 1 to 3, bulleted, numbered and check lists, quote, code block, table,
  divider, link and attach. Saves itself a second after typing stops.
- **Editing:** live formatting (Tiptap), so markdown shortcuts turn into formatting as you type and
  pasted markdown is converted. Stored as markdown text. HTML typed or pasted as text stays text.
- **Files:** picked, dropped or pasted. Stored in the private attachments bucket at
  `<user id>/notes/<note id>/<uuid>`, with the real name only in an encrypted column. Images show
  inline; PDFs, video, audio and other files show as tiles that open the usual viewer. The markdown
  holds `attachment:<id>` references, never links. 50 MB per file. Files taken out of a note are
  deleted when the note is closed (so Undo can bring one back while it is open), a note left empty
  is dropped when closed, and deleting a note deletes its files.
- **Privacy:** title, text and file names are encrypted per user like messages (fields `note_title`,
  `note` and `note_file`). Search runs in the browser.
- **Analytics:** `note_created`, `note_file_attached` (with the file kind) and `note_deleted`, as
  `feature_used`, with no content.
- Markdown formatting is for notes only; the message composer is unchanged.
- Not yet: notes in Cmd-K search, note files on the Attachments page, linking a note to a client.

Build time, Claude-built: about 3 to 4 hours.

### Onboarding

Decided 26 October 2026: as little friction as possible, nothing a new user needs is in the terminal, and the
selling points (drafts in your voice, one list across channels, contacts joined up) are shown, not skipped.
Both parts are dialogs over the app, so the app is there behind them as it fills up.

Sign up on `/login`: Continue With Google, or an email with a code (its link works too). No password to make
up. Accounts with a password can still use it.

Part A, the setup dialog (`components/onboarding/`), opens over the app for someone new and resumes where
they left off:

1. Connect: Google (Gmail and Calendar with one consent), WhatsApp (the QR code inline), iCloud (Mail and
   Calendar with one app-specific password, checked with iCloud before it is saved). Microsoft still links to
   its Settings page. The service that hosts your sign-in email comes first (from the address, or its MX
   records for your own domain), then WhatsApp. The workers start importing straight away.
2. About You, while the import runs: photo, name, what you do, and anything else Konva should know. The
   footer shows the import counting up.
3. What Konva Found: emails, WhatsApp messages, conversations and contacts brought in, and what the AI wrote:
   About You, How You Write and Who Matters Most. Each can be edited, or changed by saying what to change,
   before it is kept. Kept only into settings you have not filled in yourself.
4. Tidy Up Your Contacts: people Konva would merge, and one it would split, each a tap.
5. Try a Reply: a practice email and WhatsApp in a copy of the real reply box. Tap a choice, say what to say,
   write your own and use Edit Text, then Adjust. Nothing is sent.
6. Ready: what is set up, then Show Me Around or Start Using Konva.

Steps 3 and 4 drop out when no account is connected.

Part B, the tour (`components/tour.tsx`): a card over the app that opens each page behind it and marks it in
the navigation: Summary, Conversations, Contacts, Calendar, Attachments and Notes, New and Search, and
Personalisation. Settings, General, Getting Started runs the tour or the whole setup again.

For now steps 2 to 5 run on mock data (`lib/onboarding-demo.ts`): the import counts, the profile the AI
writes, the contact suggestions and the practice drafts. To make them real: the workers report import
counts, the AI worker writes the first profile during setup, the contact linker reports its suggestions,
and the practice reply calls the real drafting with a sample message. The profile photo is shown but not
saved yet.

How it works:

- Progress is kept in the sign-in's user metadata (`onboarding` holds the step, plus `tour`), so it follows you
  to every device. People from before onboarding have no flag and see setup only while they have no accounts.
- `/api/connect/google` and `/api/connect/icloud` save accounts exactly as the `pnpm connect:*` commands do.
  Google uses a separate Web application OAuth client (`GOOGLE_WEB_CLIENT_ID`), and its sign-ins are marked
  `client: "web"` so the worker refreshes them with that client. The worker starts a new account within
  seconds through Realtime instead of at its next 30-second pass.
- Events: `onboarding_step` and `tour_step`, content-free like the rest.
- Sign-ins now pass through the web app's server once, on their way to being stored encrypted. Like the key
  service, this moves into Confidential Space with the workers.
- Brand logos (Google, Microsoft, iCloud, WhatsApp, Gmail, Outlook) are small SVG files in
  `apps/web/public/logos`, from the official artwork, with no icon package.

To set up before it works for someone new: a Web application client in Google Cloud with the redirect URI
`<origin>/api/connect/google/callback`, the same client as the Google provider in Supabase Auth, `/login`
in Supabase's allowed redirect URLs, `{{ .Token }}` in Supabase's magic link email template so the code
shows, and custom SMTP in Supabase (its own mailer sends only a few emails an hour).

## Privacy and Encryption

The aim: nobody running Messages, including us, can read what users send and receive. The only data
we look at is usage: which features are used, how often and how long tasks take.

### Where It Stands

- Message text, subjects, previews, summaries, drafts, quotes and the outbox are encrypted field by
  field with AES-256-GCM, under a data key per user (stage 1, done).
- Each data key is stored wrapped in `user_keys`. For now the wrapping key is `KEY_WRAPPING_KEY` in
  the workers' and web app's environment (`local:v1`), so whoever holds that key and the database can
  still read everything. Cloud KMS and Confidential Space close that gap.
- Email HTML is no longer stored. View Original fetches it from Gmail or iCloud when opened.
- Accounts connected in the app send their sign-in through the web app's server once, where it is encrypted
  with `ENCRYPTION_KEY` before it is stored (see Onboarding), the same footing as the key service.
- Email addresses, phone numbers, WhatsApp chat IDs, company domains, reaction keys and outbox
  recipients are encrypted, and the database matches on their blind indexes (stage 2, done).
  `ENCRYPT_ADDRESSES` is on in the sync worker and `NEXT_PUBLIC_ENCRYPT_ADDRESSES` in the web app.
- Still readable, for a later stage: contact and company names (some are a number or an address,
  because that was all that was known), the author names on WhatsApp quotes, calendar attendees,
  email Message-IDs and References, and your own number while WhatsApp is linking.

### Stages

1. Message text encrypted (done).
2. Blind indexes (done, apart from names): email addresses, phone numbers and WhatsApp IDs stored encrypted, with a keyed
   HMAC beside each one so the database can still match a sender to a contact without reading it.
   Names, contact notes and domains are encrypted the same way. See Stage 2 in Detail below.
3. Cloud KMS: data keys wrapped by a key in Google Cloud KMS instead of `KEY_WRAPPING_KEY`.
4. Confidential Space: the sync worker, the AI worker and the key service run in Google Confidential
   Space, and KMS only unwraps keys for those attested images.
5. Encrypted browser cache and client-side search (can run alongside stage 4).
6. Content-free analytics (can run alongside stage 4).

### Stage 2 in Detail

Every address-like value gets a blind index: an HMAC under the user's index key of the value written
one standard way (`packages/crypto/src/addresses.ts` and the Python mirror, pinned by the shared
vectors). An email is lowercased, a number is E.164, a lid is `<digits>@lid`, and each kind is
prefixed so an email and a number never share a token. The database matches on the index only. The
readable value is stored encrypted next to it.

What gets an index and is encrypted:

- `contact_identities.value`, `messages.sender_address` and `to_addresses`, `unsubscribes.sender_address`
  and `priority_rules.target`.
- WhatsApp chat IDs in `threads.provider_thread_id`, and the JIDs in `provider_meta` (chat, participant,
  reaction keys).
- `organizations.domain`, plus the user's own addresses in `accounts`, which are used to leave their
  own domains out of companies.
- Encrypted with no index, because nothing matches on them: contact and company names,
  `calendar_events.attendees`, `calendar_outbox.attendees`, outbox recipients, and the emails and
  numbers on address book cards.

What moves out of SQL: the database can no longer lowercase, split or pattern-match these values, so
the work that did is done by the sync worker (or the browser, which holds the same keys) before it
writes:

- Working out a company from a domain, including the personal-mail list and the user's own domains.
- Checking an address or number is valid.
- Name fallbacks such as using the number when there is no name.
- Spotting placeholder names.

`ingest_email`, `ingest_whatsapp`, `whatsapp_contact`, `whatsapp_map_lid`, `create_contact`,
`import_address_book_cards`, `merge_contacts`, `split_contact` and the company trigger are rewritten
to take indexes and ciphertext from the caller.

Rollout, in the same safe order as stage 1:

1. Add the index columns beside the readable ones, with nothing removed.
2. Writers fill both.
3. A backfill indexes existing rows.
4. The SQL functions switch to matching on indexes.
5. Readers accept ciphertext.
6. A backfill encrypts the readable values, and `ENCRYPT_ADDRESSES` switches on.

Each step can be checked before the next starts.

Left for later: email Message-IDs and References, which contain the sender's domain. Threading
matches on them, so they would need indexes of their own.

How it was done:

- The rules for writing a value one standard way are in `packages/crypto/src/addresses.ts`, with
  the Python copy checked by the shared vectors. The company rules are in
  `packages/email-text/src/company.ts`.
- The sync worker's address indexer fills any missing index every 30 seconds. A changed value clears
  its index (`clear_stale_address_index`), so nothing is left matched on a stale one.
- The ingest and contact functions take indexes and ciphertext from their callers. A call without
  indexes still matches on readable values, so the old and new code could run side by side during
  the switch.
- Readers in the web app, the sync worker and the AI worker open addresses wherever they load them
  (`openAddresses`).
- The backfill script, `apps/worker/scripts/encrypt-addresses.ts`, has a `--decrypt` way back. Its
  temporary write function was dropped after it ran (20261025001300).

Next, for names: encrypt contact and company names with the name field and a placeholder flag set
by the writer, so the database no longer needs to read names to tell a real one from a number.

### Google Cloud KMS

- A Google Cloud project of its own, `messages-keys`, holding only the key ring and nothing else,
  with as few people able to change its IAM as possible. Billing and audit logs stay on.
- One key ring, `messages`, in `africa-south1` (Johannesburg) to keep keys in South Africa for POPIA,
  if HSM keys and Confidential VMs are offered there by then (otherwise the nearest region that has
  both, with the workers in the same region), with one symmetric key, `user-data-keys`, protection level HSM. Rotate it yearly. Old versions stay
  enabled so existing wrapped keys still open, and keys are rewrapped under the new version in the
  background.
- A new wrapper, `kms:v1`, beside `local:v1` in `packages/crypto/src/wrap.ts` and the Python mirror.
  It calls KMS Encrypt and Decrypt with the user ID as additional authenticated data, so a wrapped
  key cannot be moved to another user. `wrapped_by` in `user_keys` records which wrapper made each
  row.
- Unwrapped data keys stay in worker memory only, cached for a short time (about 10 minutes), and are
  never written to disk or logs.
- Migration: a one-off script unwraps each key with `local:v1` and rewraps it with `kms:v1`. The data
  keys themselves do not change, so no message is re-encrypted. Once every row is `kms:v1`,
  `KEY_WRAPPING_KEY` is deleted from every environment and from the backup copy.
- Key destruction has a 30-day scheduled delay in KMS. Deleting a user's account deletes their
  `user_keys` row, which leaves their messages unreadable even in database backups (crypto-shredding).
- Cost: a few dollars a month for the key, plus about $0.03 per 10,000 operations. Caching keeps the
  operation count low.

KMS alone moves the secret out of `.env` files, but whoever runs the workers can still ask KMS to
unwrap keys. Confidential Space removes that.

### Google Confidential Space

- The sync worker, the AI worker and the key service (today `/api/keys` in the web app) are built as
  container images and run on Confidential VMs (AMD SEV) with the Confidential Space image. Memory is
  encrypted by the CPU, and the operator cannot SSH in, attach a debugger or read the container.
- At boot the VM gets an attestation token from Google that names the exact image digest, that it is
  the production Confidential Space image, and that debugging is off.
- A workload identity pool in `messages-keys` trusts only those tokens. The KMS Decrypt permission is
  granted to the pool on condition of the expected image digests and
  `support_attributes` containing `STABLE`. A laptop, a debug image or a changed image gets no keys,
  even with our credentials.
- The browser's key service moves into Confidential Space too. It checks the user's Supabase session
  and returns their data key over TLS that ends inside the enclave. The web app on Vercel never sees
  the key.
- Releases: images are built by a pinned CI pipeline from a tagged commit. Each release publishes the
  image digest and the commit it was built from, so anyone can check what is running against the
  source. Changing the allowed digests in the KMS policy is the only way to ship, and every change
  shows in the audit log.
- Outbound traffic from the workers goes only to Gmail, iCloud, WhatsApp, Supabase, KMS and Vertex
  AI. Logs leave the enclave only as counts and timings, never content.
- Gemini is called through Vertex AI in the same Google organisation, under terms with no training and
  no retention.
- Running cost: a small Confidential VM (n2d-standard-2) for each worker, roughly $70 to $100 a month
  each before committed-use discounts. The free Supabase plan and Vercel stay as they are.
- What it does not protect: a user's own browser, and Google itself, which we trust for KMS and the
  attestation service.

## Product Analytics

Built (October 2026). This is privacy Stage 6 in detail. Everyone's app and both workers record the events
below, and the Analytics page in the rail (above Settings) shows them to mattprowse03@gmail.com only.

### Rules

- Content-free. An event holds a name, a time, a coarse screen and small allow-listed values: numbers,
  durations, yes/no and a fixed list of words. Never message text, subjects, names, addresses,
  numbers, search words or anything typed. Search logs the length of the query, not the query.
- The event types are in code (`packages/analytics/src/index.ts`) as a map from name to its values. The
  database then keeps only numbers up to a billion, yes/no, and plain code words (lowercase letters, digits
  and `_ . : -`, starting with a letter), so a name, an address, a subject or a sentence cannot be stored
  even by a bug. Text is dropped, never tidied into a word. Checked in
  `analytics_clean_props` and tested against real inputs.
- The user is a keyed hash of their ID (the key sits in a table nobody can read), no IP address, no
  third-party script.
- Stored in our own table, `analytics_events`. The web app writes through `track()` (a database function
  that checks the Share Usage Data switch); the workers write through `analytics_record`, service role only.
  Only the owner account can read the table (policy on the email in the sign-in token), and no signed-in
  user can insert directly. Tested with a second account.
- Settings, General has a "Share Usage Data" switch (on by default). Off means nothing is recorded, in the
  browser and again in the database.
- Events older than 13 months are rolled into daily counts and deleted, nightly (pg_cron, `analytics_prune`).
  `analytics_forget(user)` removes one person's events.

### Part 1: How Well The AI Works

Most of this is already in the database; the gap is that a correction does not record what the AI
had said at that moment, and nothing records which prompt produced it.

A rate on its own ("20% of drafts are edited") says nothing about what to change. Each AI number
below is therefore always split by things that explain it, and the page leads with the splits:

- Pairs, not rates: what the AI said and what the user changed it to (newsletter to personal, Junk
  to Not Junk). The most common pairs are the list of what to fix first.
- Content-free traits of the message, worked out in the worker or the browser: channel, sender type
  (person, company, marketing, WhatsApp group), whether it has an unsubscribe header or an
  attachment, length bucket, language, thread length, time of day. "Junk is wrong 40% of the time
  for receipts from companies with an unsubscribe header" is a prompt change; "Junk is wrong 8%" is not.
- What an edit did, not what it said, measured in the browser when a draft is sent: shorter or
  longer (and by how much), greeting changed, sign-off changed, a question added or removed,
  tone moved formal or casual, emoji added, paragraphs merged or split. "Most edits cut a third of
  the length" is a prompt change.
- Your own account is also a user. On the Analytics page, in your browser, your own corrections and
  edited drafts can be listed with their real text, decrypted with your own key like anywhere else
  in the app. Other users' text is never readable, only the traits above.
- Later, an optional "Send This Example" on a draft or label, shown to the user each time, that shares
  that one item on purpose. Not part of the always-on analytics.

Storing what the AI originally said does not break the privacy rule. It is a label from a fixed list
(priority, category, Junk), a prompt version and a duration, with no text in it. On the `feedback`
row it stays in the user's own encrypted-by-row data; in an analytics event it travels without any
message ID.

| Question | Measured by | Needs |
| --- | --- | --- |
| Is sorting right? | How often a priority, category or Junk label is corrected, by label, model and sender type (person, company, marketing, WhatsApp) | Done: carried on each correction event, with the prompt code on `message_ai` |
| Is Junk too strict or too loose? | Not Junk after Junk (false positive); Junk after a normal label (false negative); an unsubscribe soon after a message was kept | Same as above |
| Is Needs Reply right? | Of messages marked Needs Reply, the share replied to in 7 days; of the others, the share replied to anyway | Derivable from `messages` |
| Are drafts good? | `draft_outcomes.edit_ratio`: sent as is, lightly edited, heavily edited, discarded. Time from draft shown to sent | `draft_shown`, `draft_discarded`, `draft_regenerated` |
| Do one-tap choices help? | Choice offered, tapped (by kind: accept, decline, other time, answer), or ignored | `choice_shown`, `choice_tapped` |
| Is the AI learning? | Edit ratio over time for one user, and number of style rules | Derivable |
| Do summaries save reading? | Summary shown, then the original opened (a miss) or the conversation answered without opening it (a hit) | `summary_shown`, `original_opened` |
| Is the spoken brief used? | Plays started, finished, second where people stop, speed, skips | `brief_play`, `brief_stop` with position |
| Are voice transcripts good? | Transcript failures, and the original audio played after reading the transcript | `transcript_error`, `audio_played` |
| What does it cost and how fast is it? | `ai_usage`: cost per feature and per active user, cache hit share, median and slow latency, error and retry rate | Latency column on `ai_usage` |

### Part 2: What People Use

Screens log a route name only (`/inbox`, never `/inbox/<id>`).

- Reach: daily, weekly and monthly active users, sessions, time on each screen, return rate by
  week of sign-up.
- Features: opens of New, Search (and whether a result was picked, and its rank), Compose, Reply,
  Guided Choices, New Event, New WhatsApp Chat, Contact Edit, Merge and Split, Attachments (open,
  download), Summary, Calendar, Brief, and which Settings are changed.
- Dialogs: opened, submitted, cancelled or dismissed, time open, and the names (never values) of the
  fields touched and of validation errors shown. This shows which dialogs people abandon.
- Funnel: signed in, first account connected, first sync finished, first Summary seen, first draft
  sent. Time between each step, and where people stop. Connect attempts log provider, step and
  error code.
- Friction: error codes (not messages), time to first conversation list, sync lag from arrival to
  shown, empty states reached, and the same action repeated several times in a few seconds.
- Reliability: sync and send failures by provider, outbox retries, WhatsApp reconnects.

### What Records What

| Where | Events |
| --- | --- |
| Browser, tracker | `app_open`, `screen_view`, `screen_time` (only while the tab shows), `load_timing`, `error` (error type only), `rage_click` (three clicks on one thing in 1.5s) |
| Browser, dialogs | `dialog_open`, `dialog_close` (submit or cancel, seconds, field names touched) from the shared dialog component, by a name the code gives each dialog |
| Browser, features | `feature_used`, `setting_changed` (which, never the value), `search`, `thread_opened` (from Summary, list or search), `original_opened`, `attachment_used`, `empty_state` |
| Browser, labels | `label_corrected` (what you were shown against what you chose, with the message's traits and prompt code), `thread_action` (archive, delete, pin, read, Junk and so on, never which conversation), `reply_sent` |
| Browser, drafts | `draft_requested`, `draft_shown`, `draft_failed`, `draft_discarded`, `draft_sent` (with what the edit did), `choice_shown`, `choice_tapped` |
| Browser, media | `brief_play`, `brief_stop` (seconds and share reached), `audio_played` |
| AI worker | `triaged` (one per label shown: traits, labels, prompt code), `ai_call` (feature, model, prompt code, time, tokens, cost, tries, failure code). Traits and the prompt code are also kept on `message_ai` |
| Sync worker | `account_connect`, `first_sync_done`, `sync_error`, `send_result` (provider and whether it went), `wa_reconnect` |

The prompt code is a short hash of the exact instructions sent to the model, so results can be compared
across prompt changes without anyone writing a version number.

### Event Shape

`{ name, at, user, session, screen, app_version, size (phone, tablet, desktop), props }`, with `props`
limited to the list for that name. About 40 event names cover everything above.

### The Analytics Page

`/analytics`, two tabs in the usual Settings style: Usage and AI, for the last 7, 14 or 30
days, each number with its change on the period before. The AI tab leads with the pairs and the
splits ("Where It Goes Wrong": pick Junk, Priority or Category, then split by kind of sender, channel,
unsubscribe header, attachment, length, time of day, known sender, what decided it, or prompt version).
The page loads up to the newest 60,000 events and works the numbers out in the browser
(`packages/analytics/src/stats.ts`, tested). When volume grows, move that into database views.

### Limits

- A reply's link to Needs Reply is approximate: it counts replies sent to conversations flagged Needs Reply,
  not Needs Reply conversations never answered.
- Tone moved, greeting and sign-off changes are worked out with simple rules, so they are good for trends,
  not exact.
- Message time of day uses the person's saved time zone; if there is none it is UTC.
- Sync lag (message arrival to shown) is defined but not recorded yet.
- `triaged` is one row per label shown, the biggest table; it rolls into daily counts after 13 months.
- Your own text (corrected labels, edited drafts) is not shown on the page yet. See Order Of Work.

### Order Of Work

1. Done: table, `track()`, owner-only policy, opt-out and retention, prompt code and traits on `message_ai`.
2. Done: tracker, dialogs, features, labels, drafts, brief, both workers.
3. Done: the Analytics page with Usage and AI. The funnel was taken out for now and comes back later.
4. Next: a list on the Analytics page of your own corrections and edited drafts with their real text,
   decrypted in your browser with your own key, for working out what to change in the prompts.
5. Later: "Send This Example", shown to the user each time, if you ever want text from other users.

### Decided

- Our own table. No PostHog or other hosted tool.

### To Decide

- Whether other users should ever see their own numbers, or this stays owner-only.

## AI Assistant Connections (MCP)

Users can connect Messages to the AI assistant they already use, such as Claude, ChatGPT or Gemini,
and ask it things like "Who is waiting on a reply from me?", "Summarise my chat with Mrs Naidoo" or
"Am I free for a viewing on Thursday at 3?". Messages runs an MCP server (the Model Context Protocol,
an open standard those assistants support) that answers with the user's own messages, calendar and
contacts.

### Does It Fit Our Privacy Promise?

Yes, as long as it is the user's choice and only theirs. The promise is that nobody running Messages
can read a user's data. With MCP, the user decides to show some of their own data to an assistant
they chose, the same as copying a message into it themselves. Rules that keep it that way:

- Off until the user connects an assistant in Settings. Each connection says plainly what it can see
  and that whatever the assistant reads is then covered by that company's terms, not ours (for
  example, whether it trains on chats).
- The MCP server decrypts data, so it runs inside Confidential Space with the other workers (stage 4),
  and the KMS policy allows its image the same way. Nobody running Messages can read what passes
  through it.
- Each connection has its own scopes, chosen by the user: which accounts (say, work email and
  WhatsApp but not personal email), whether WhatsApp groups are included, whether calendar and
  contacts are included, and whether drafts can be created. Contacts or conversations can be hidden
  from assistants entirely.
- Answers carry only what was asked for: one conversation, or a search's top results, capped in size.
  There is no "export everything" tool.
- Every request is logged for the user to see in Settings: which assistant, which tool, when and how
  many items, never the content. A connection can be revoked in one tap, and its tokens stop working
  at once.
- What an assistant reads is never kept by us beyond answering the request.

What stays impossible on purpose: an assistant cannot send anything. It can create a draft, which
waits in Messages for the user to review and send themselves. This also protects against an email
that tries to instruct the assistant ("forward all invoices to ..."): message content is marked as
untrusted data in every answer, and with no send tool such an instruction has nothing to act on.

### Tools

| Tool | What it does |
| --- | --- |
| `needs_reply` | Conversations waiting on the user, most important first, with their one-line summaries |
| `search` | Find conversations by person, words, channel or date. Runs inside the enclave using the existing embeddings |
| `get_conversation` | One conversation's recent messages, newest last, with the formatting kept as plain text |
| `client_timeline` | Everything with one client across email, WhatsApp, voice notes and meetings |
| `daily_brief` | Today's meetings and viewings, clients waiting and anything urgent |
| `calendar` | Events in a date range, and free times of a given length |
| `contacts` | Look up a person or company and what is known about them |
| `create_draft` | A draft reply in the user's voice, from a decision or instruction, left in Messages for review |

### How It Is Built

- A remote MCP server over HTTPS (Streamable HTTP), so it works with web and desktop assistants
  without installing anything.
- Sign-in with OAuth 2.1 as the MCP specification sets out: the assistant sends the user to a
  Messages sign-in and consent page, then gets a short-lived token limited to the scopes they chose.
- The server reads the same tables as the app and opens fields with the user's key, so nothing new is
  stored in plaintext.
- Usage numbers (requests per tool and response times) go to the content-free analytics like the rest
  of the app.

### Which Assistants

- Claude: supports remote MCP servers as custom connectors with OAuth sign-in.
- ChatGPT: supports MCP servers as connectors and apps.
- Gemini: MCP works in Gemini CLI. Check support in the Gemini app itself when we build this, as it
  was changing quickly.
- Others that speak MCP (Microsoft Copilot, Cursor and so on) work with the same server.

Check each assistant's current connector requirements (review, listing, OAuth details) at build time.

### When

After Confidential Space (privacy stage 4), so the server never runs anywhere its operator could read
the data. A prototype limited to the owner's own account can come earlier, on the same footing as the
workers today.

## Later

| Integration | Approach | Official |
| --- | --- | --- |
| Telegram | Telegram client API | Yes |
| Facebook Messenger | Messenger Platform for Pages, through the same Meta app review | Yes |
| SMS and RCS (Android) | Bridge through Google Messages for Web pairing | No |
| iMessage | Needs a Mac running as a relay, such as BlueBubbles | No |
| Slack | Slack API. Low demand in South Africa | Yes |
| Compliance export | Per-client archive of WhatsApp and email for FAIS, legal and POPIA records | n/a |
| Agency accounts | Shared team view, client history stays with the agency | n/a |
| AI assistants (MCP) | Remote MCP server for Claude, ChatGPT, Gemini and others, after privacy stage 4. See AI Assistant Connections | Yes (open standard) |
| Admin systems | Property CRMs (Propdata, Entegral), legal practice tools (LEGALSUITE, GhostPractice, AJS), Astute for advisers. Build when paying customers ask | Varies |

The long-term goal: every messaging app a professional uses, in one place.

## Approvals and Risks

These take calendar time no matter how fast the code is written, so start them early:

- Google verification and the yearly CASA security assessment for Gmail access. Until then, 100 test
  users at most. Decided 26 October 2026: verification is finished before launch, so launch is not
  held to 100 users.
- Microsoft publisher verification. Many firms also need their IT admin to approve the app, and
  Teams chat access makes that more likely.
- Zoom Marketplace review before other Zoom accounts can connect.
- Instagram through instagrapi breaks Meta's terms like Baileys does, and Instagram is stricter:
  sign-ins from servers get security checks, and accounts can be locked or banned. Tell customers plainly.
- Google Chat and Meet transcripts need Google Workspace, and the Chat API needs a Chat app set up in
  the Google Cloud project.
- WhatsApp through Baileys breaks Meta's terms and numbers can be banned, business numbers included.
  The user accepts this risk. Tell customers plainly.
- LinkedIn through linkedin-api carries the same kind of risk. LinkedIn restricts accounts quickly
  when a session is used from somewhere new or acts like a bot, sometimes until ID is verified.

## Timeline

Claude writes most of the code, so building the MVP list is about a month. What takes longer is
testing on real accounts, refining from feedback and waiting on the approvals above. Build time is
about 2 hours each weekday morning, 2 hours each evening and full days on weekends.
