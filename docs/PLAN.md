# Product Plan

What we have agreed on so far: who Messages is for, what is in the MVP, how the key features work and
what comes later. Update this file whenever a decision changes.

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

## MVP

| Area | What | Status |
| --- | --- | --- |
| Mail | iCloud+ (IMAP and SMTP), Gmail | Built |
| Mail | Microsoft 365 and Outlook through Microsoft Graph | To do |
| Calendar | Google Calendar | Built |
| Calendar | Microsoft Calendar (Graph), Apple Calendar (CalDAV, app-specific password) | To do |
| WhatsApp | Personal and WhatsApp Business app numbers through Baileys | Built |
| WhatsApp | Voice notes transcribed and summarised by Gemini | To do |
| Meetings | Google Meet, Teams and Zoom transcripts attached to the client | To do |
| Privacy | Per-user encryption of stored data | In progress |
| Email display | Bold, italics and the like in email and WhatsApp bubbles (see below) | Built, not yet checked on real mail |
| Drafts | Guided drafting with one-tap choices, email and WhatsApp (see below) | Built, not yet checked on real messages |
| Brief | Spoken daily brief (see below) | Built |
| Clients | Client timeline across every channel | To do |
| Leads | Property24 and Private Property enquiry emails turned into clients | To do |

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

- Triage already reads every incoming email and WhatsApp message. In the same model call it returns
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
- Gemini 3.8 Flash TTS reads it aloud (voice Kore). About a minute of audio costs about $0.02.
- The script and the audio are stored encrypted in the briefs table and deleted after 7 days.
- On the Summary page, Listen plays it (or asks for one and plays it when ready), the script shows
  while it plays, and the phone's lock screen gets play and pause. Refresh writes a new one.
- Still to do: a shorter audio format (it is WAV, about 3MB a minute) and a setting for the time.

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
| Instagram | Instagram API for Business and Creator accounts | Yes |
| Google Tasks, Microsoft To Do | Their APIs | Yes |
| Apple Reminders | Hard: the newer Reminders format is not reliably reachable through CalDAV | Partly |
| Telegram | Telegram client API | Yes |
| LinkedIn | A paid service such as Unipile, or an open-source bridge. LinkedIn restricts accounts often | No |
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
  users at most.
- Microsoft publisher verification. Many firms also need their IT admin to approve the app.
- Meta app review for the Instagram API.
- WhatsApp through Baileys breaks Meta's terms and numbers can be banned, business numbers included.
  The user accepts this risk. Tell customers plainly.
- LinkedIn and other unofficial bridges carry the same kind of risk.

## Timeline

Claude writes most of the code, so building the MVP list is about a month. What takes longer is
testing on real accounts, refining from feedback and waiting on the approvals above. Build time is
about 2 hours each weekday morning, 2 hours each evening and full days on weekends.
