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
  to `public.draft_context` (`20261028110700_draft_context`), so the model is asked after one trip
  to the database instead of three or four. The table is checked every
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
  `messages`, which Realtime sends to the app on every change). `similar_replies` only returns an
  incoming message with its reply, so mail nobody answered is not embedded. A trigger queues a message
  when its reply is stored (`20261027100100_embed_replied_mail_only`); the mail being drafted for is
  embedded on the spot.
  Until migration `20261024110000_ai_message_embeddings` is applied, the old `messages.embedding`
  column is used. Drafts use `similar_replies` to show how you answered the emails most like the one
  being answered, then fill the rest with your recent sent mail.
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

`pnpm instagram` runs the Instagram connector (`ai/connectors/instagram`), a process of its own that
syncs Instagram direct messages through [instagrapi](https://github.com/subzeroid/instagrapi), Instagram's
private mobile API. Install it once with `pip3 install -r apps/ai/requirements-instagram.txt` (pinned).
It needs `ENCRYPTION_KEY` (the sync worker's) besides the Supabase and key settings, and takes an
optional `INSTAGRAM_PROXY`.

- **Connecting.** Settings > Connected Accounts > Instagram saves the username and password encrypted.
  The connector signs in once, asks for any code Instagram sends (email, SMS or two-factor) through
  `instagram_sign_ins`, keeps instagrapi's settings (session and a fixed device) encrypted in
  `account_credentials.refreshed`, and drops the password. Later runs reuse the session and never sign in
  again on their own.
- **Syncing.** The inbox is read every 3 minutes with jitter, every 6 after half an hour with nothing new
  and every 12 after two hours. Threads, messages, contacts and files are stored like WhatsApp chats
  (`ingest_instagram`). Shared posts and reels are links; disappearing media is never opened.
- **Safety.** Rate limits back off from 15 minutes to 4 hours, `feedback_required` from 6 to 24 hours. A
  challenge, a sign-out or a ban sets the account to Needs Attention with the reason and stops it until
  you connect again. Nothing is sent on its own: only replies you queue (text only for now), and a thread
  is marked seen only when you open it in the app.

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
