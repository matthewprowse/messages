# AI worker

Python, standard library only. It reads and writes Supabase with the service role and calls Gemini.

```bash
pnpm ai        # from the repo root
pnpm test:ai   # unit tests
```

Settings live in `apps/ai/.env` (see `.env.example`). It never logs message content or addresses.

## What it does

- **Triage.** Each new incoming email from the last 30 days gets a priority, a category, a junk flag
  and a one-line summary, using the fast model with minimal thinking, up to 8 emails of one account
  per call. Your own signals then win over the model: priority rules, senders you unsubscribed from,
  and Important, Not Important, Junk and Not Junk corrections. The conversation takes the triage of its
  latest incoming email, so the model is only asked about that one: older emails in the conversation,
  mail from senders you unsubscribed from and conversations you marked Junk are recorded without a
  call, and an email that arrived in two of your accounts (the same Message-ID) is triaged once. So is
  bulk mail (an unsubscribe header) from a sender the model has labelled a low or normal priority junk
  newsletter or notification, needing no reply, in each of its last 3 answers, when none of that
  sender's conversations was ever corrected and the last answer is under 14 days old (the model looks
  again after that). The result is the last answer with the subject as its summary, and the label's
  source is `sender`. The answers come from `sender_history`, by the sender's blind index.
- **Drafts.** The app adds a pending row to `drafts`; this fills in the body within a few seconds.
  It writes from the conversation, what you told it about yourself, learned style rules, saved
  writing examples and your own recent sent mail, to that person first. All of it is read in one call
  to `public.draft_context` (`20261028110700_draft_context`); the few reads it does not cover (settings,
  calendar, files on offer, the budget, the draft limit, the key, similar replies, rules) run at the same
  time as it or right after it (`ai/drafts_gather.py`), not one after another. The table is checked every
  1.5 seconds, and every half second for two minutes after a draft was asked for; up to 4 drafts are
  written at once, one at a time per conversation. The prompt starts with what is the same for all
  your drafts, so asking again with another tone is mostly billed at Gemini's cached rate.
- **Learning.** When a reply that started as a draft is sent, the draft and what you sent are stored
  in `draft_outcomes`. If you changed it by 10% or more, the model turns the changes into short
  style rules in `style_rules`. A rule seen again gains support, and the strongest are used first.
- **Voice.** Your latest 40 sent emails are read once you have sent 10, and again every time you
  send 10 more (`profiles.voice_learned_outbound`), and written down as global style rules from
  `sent_mail`. A rule the newest learning no longer finds is turned off as unsupported, never
  deleted, and comes back if your mail shows it again. Rules you turned off stay off.
- **Choices.** Tones picked again and again (Shorter, More Formal, More Casual) become rules, and the
  model turns repeated instructions, guided drafting picks (what you decided and what you then sent)
  and thrown away drafts into rules, with the source `signals`. A draft you throw away and then
  answer yourself is learned from like an edited one.
- **Daily brief.** At your briefing time (`profiles.briefing_time`, in `profiles.timezone`, which the
  app keeps in step with your device), or when the app asks, today's calendar and the conversations
  waiting on you become a short script, read aloud by `GEMINI_TTS_MODEL` (default
  `gemini-3.8-flash-tts`) in the voice chosen in Settings (`profiles.brief_voice`). Speech is nearly
  all of what a brief costs, so the morning brief is only a script (status `written`) until someone
  presses Listen, which sets `speak_pending`; a brief the app asks for is written and spoken at once.
  The audio is spoken in parts, the short first one first, so the app can start playing within seconds. The
  script (in `briefs`) and the WAV parts (in `brief_parts`) are stored encrypted and deleted after 7
  days. It runs in its own thread.
- **People and companies.** Everyone you have written to 3 or more times gets a style note (how you
  write to them) and a summary (who they are), refreshed after 5 more messages with them and at most
  every 3 days. Each company in `organizations` gets a short summary of what it sends you, using the
  fast model, refreshed after 20 more emails and at most every 30 days. A user with no new mail is
  not looked at again for 6 hours.
- **Similar emails.** Incoming messages you have replied to are embedded with `gemini-embedding-2` at
  768 dimensions, newest first and then older mail 48 at a time, into `message_embeddings` (not
  `messages`, which Realtime sends to the app on every change). Each vector is stored sealed with the
  user's data key (`embedding_data`), so the database never holds one readable. The search runs in this
  worker (`ai/similar.py`): the user's newest 2000 vectors are read (every page at once), opened in memory,
  cached for 45 minutes and then searched as they are for up to 6 hours more while a fresh read runs in the
  background (so only a cold start waits for the read), and compared by cosine; `public.reply_pairs` then returns each nearest incoming message with its reply,
  so mail nobody answered is not embedded. A trigger queues a message when its reply is stored
  (`20261027100100_embed_replied_mail_only`); the mail being drafted for is embedded on the spot.
  A user with no key yet is not embedded. To seal vectors made before this, apply
  `20261102800000_sealed_message_embeddings`, then run `python3 -m ai.seal_embeddings` (dry run) and
  `--apply`, then apply `20261102800100_drop_plaintext_embeddings`. Drafts use this search to show how you answered the emails most like the one
  being answered, then fill the rest with your recent sent mail.
- **Company logos.** Only when `COMPANY_LOGOS=true`. The sync worker finds and frames each company's
  logo candidates into one numbered sheet (`company_logos`, shared by every user); this judges the sheet
  with the fast model in one call, and when nothing passes asks the fast model with Google Search
  grounding for the official logo, which goes back to the sync worker to frame and judge again. Only
  company names and domains are sent. Costs are filed against the owner's account as `logos`.
  `python3 -m ai logos` works through the waiting steps once and stops, for a backfill.
- **Usage.** Every model call is recorded in `ai_usage` with its tokens, cached tokens and cost, filed
  against the connected account it served (a triage call covering several conversations has no
  `thread_id`). Rows are written in the background. Prices are in `ai/pricing.py`, from Google's paid
  tier as of 22 October 2026, including the Gemini 3.8 Flash price change on 1 January 2027.
  Settings > Usage shows the totals.

Requests to Supabase and Gemini reuse kept-alive connections and ask for gzipped responses
(`ai/http.py`). A Gemini call is retried on rate limits, overload and dropped connections, after the
wait Gemini asks for; when that wait is over a minute (a daily quota) it fails at once and the
message waits out its own back-off.

## Instagram

`pnpm instagram` runs the Instagram connector (`ai/connectors/instagram`), a process of its own that syncs
Instagram direct messages for two kinds of account into the same tables. Which kind an account is, is the
`kind` in its stored credentials: `"official"` (Business or Creator) or `"private"` (Personal; also what
credentials saved before there was a kind count as). It needs `ENCRYPTION_KEY` (the sync worker's) besides
the Supabase and key settings.

- **Business or Creator (official).** Settings > Connected Accounts > Instagram sends the person to
  instagram.com to sign in and approve (Instagram API with Instagram Login, scopes
  `instagram_business_basic` and `instagram_business_manage_messages`); `apps/web` trades the code for a
  60 day token and stores it encrypted. The connector (`official.py`, plain HTTPS, no instagrapi) reads
  `/me/conversations` and each changed conversation's messages through `graph.instagram.com` about every
  minute (every 3 after half an hour of quiet, 10 after two hours) and sends replies with `POST /me/messages`.
  A reply is refused before sending, with "send this one in Instagram", when the person's last message is over
  24 hours old, and Instagram's own refusal for the window gets the same message. The token is renewed with
  `ig_refresh_token` once it has under 20 days left (checked every 6 hours) and saved in
  `account_credentials.refreshed`; if it cannot be renewed the account shows a reason while there is time to
  connect again. Instagram only returns the 20 newest messages of a conversation. Polling is the seam for
  webhooks later: a receiver would verify Meta's `X-Hub-Signature-256` and call `store_conversation` for the
  conversations it names. The Meta app's ID and secret live in `apps/web/.env.example` only (the connector
  needs no new settings); with them unset the Business or Creator choice says "Not available yet".
- **Personal (private).** The person types their username and password in the app. The connector signs in
  once through [instagrapi](https://github.com/subzeroid/instagrapi), Instagram's private mobile API (install
  it with `pip3 install -r apps/ai/requirements-instagram.txt`, pinned; only this kind needs it), asks for any
  code Instagram sends (email, SMS or two-factor) through `instagram_sign_ins`, keeps instagrapi's settings
  (session and a fixed device) encrypted in `account_credentials.refreshed`, and drops the password. Later
  runs reuse the session and never sign in again on their own.
- **Proxy.** `INSTAGRAM_PROXY` (optional, e.g. `http://user:pass@host:port`) is the default for personal
  accounts. A personal account's own `proxy` in its stored credentials overrides it, and survives
  reconnecting, so a different home or mobile address can be set per account. None is needed to start.
- **Syncing (personal).** The inbox is read every 3 minutes with jitter, every 6 after half an hour with
  nothing new and every 12 after two hours. Threads, messages, contacts and files are stored like WhatsApp
  chats (`ingest_instagram`). Shared posts and reels are links; disappearing media is never opened.
- **Safety.** Rate limits back off from 15 minutes to 4 hours, `feedback_required` from 6 to 24 hours. A
  challenge, a sign-out, a withdrawn permission or a ban sets the account to Needs Attention with the reason
  and stops it until you connect again. Nothing is sent on its own: only replies you queue (text only for
  now), and a personal thread is marked seen only when you open it in the app (the official API has no read
  receipt for this, so a Business thread is not).

## Models

| Use | Model | Setting |
| --- | --- | --- |
| Drafts and learning | `gemini-3.8-flash` | `GEMINI_MODEL` |
| Triage, junk and company summaries (minimal thinking) | `gemini-3.5-flash-lite` | `GEMINI_FAST_MODEL` |
| Embeddings | `gemini-embedding-2` | `GEMINI_EMBED_MODEL` |

A model missing from `ai/pricing.py` is recorded at $0, so add its price when you change models.

## Not yet

- Triage for WhatsApp, which arrives with the WhatsApp connector. Conversations with
  `threads.triage_enabled` off (WhatsApp groups by default) are already skipped.
