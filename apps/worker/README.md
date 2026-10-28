# Sync worker

The always-on service that keeps your accounts in sync with Supabase. It handles iCloud+ Mail, iCloud
Calendar, Gmail, Google Calendar, Outlook, Outlook Calendar and WhatsApp.

## Setup

1. Add the service role key to `apps/worker/.env`. Find it in the Supabase dashboard under
   Project Settings, then API Keys. `ENCRYPTION_KEY` is already generated there. Back it up somewhere
   safe: without it, stored passwords cannot be read and every account has to be reconnected.
2. Create an app-specific password at account.apple.com, under Sign-In and Security.
3. Connect the account. The password is typed only into your terminal, checked with iCloud, then stored
   encrypted:

   ```bash
   pnpm connect:icloud
   ```

4. Start syncing:

   ```bash
   pnpm worker
   ```

## Connecting Google

Gmail, Google Calendar and Google Tasks share one Google sign-in. Google needs an OAuth client of your own first.
This is a one-time setup in Google Cloud, about ten minutes.

1. At [console.cloud.google.com](https://console.cloud.google.com), create a project named Messages.
2. Under APIs and Services, then Library, enable the **Gmail API**, the **Google Calendar API**
   and the **Google Tasks API**.
3. Open **Google Auth Platform** and choose Get Started:
   - App name: Messages. Support email and contact email: your own address.
   - Audience: **External**. If your Gmail is a Google Workspace account you manage, choose
     **Internal** instead; there is then no unverified-app warning and nothing to publish.
4. Under **Audience**, choose **Publish App** so the status reads In Production. Leave it unverified.
   An External app left in Testing has its sign-in expire every 7 days, which would stop sync weekly.
5. Under **Data Access**, add the scopes `https://www.googleapis.com/auth/gmail.modify`,
   `https://www.googleapis.com/auth/calendar.readonly` and
   `https://www.googleapis.com/auth/contacts.readonly` (names and photos of your contacts) and
   `https://www.googleapis.com/auth/tasks` (your Google Tasks). This only documents what the app asks for.
6. Under **Clients**, create a client with application type **Desktop app**, named Messages Worker.
   Copy its client ID and secret into `apps/worker/.env`. Google shows the secret only once.

   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

7. Connect your account. Google opens in your browser and returns to a one-time address on this Mac.
   It warns that Google has not verified the app; choose Advanced, then Go to Messages. Leave every
   box ticked:

   ```bash
   pnpm connect:google
   ```

8. Restart the worker, since it reads the client from `.env` when it starts.

Why Desktop app and the terminal: a desktop client may return to any local port, so there is no
redirect address to register, and the refresh token is encrypted by the worker without the web app
ever holding the encryption key. A hosted web sign-in can replace this when the app is deployed.

What Google allows: an unverified app is fine for you alone, and for up to 100 people who all see the
warning. Opening it to more people needs Google's verification and a yearly security assessment
(CASA), because reading Gmail is a restricted scope.

Meet transcripts and Google Chat are optional: `pnpm connect:google` asks, and Settings has a box for
them. They need a Google Workspace account (a personal Gmail account has neither) and, in the Cloud
project, the **Google Meet REST API** and the **Google Chat API** enabled, with the Chat API's
Configuration tab filled in (app name, avatar URL, description, Interactive Features off). Without that
Chat app every Chat request fails. Scopes: `meetings.space.readonly` and `chat.spaces.readonly` are
sensitive, `chat.messages` is restricted like Gmail, plus `openid` and `email`.

## Connecting Microsoft

Outlook mail and Outlook Calendar share one Microsoft sign-in. It works for Microsoft 365 work and school
accounts and for personal Outlook.com, Hotmail and Live accounts. Microsoft needs an app registration of
your own first, about five minutes.

1. At [entra.microsoft.com](https://entra.microsoft.com), open **App registrations** and choose
   **New registration**:
   - Name: Messages.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft
     accounts**.
   - Redirect URI: platform **Public client/native (mobile & desktop)**, value `http://localhost`.
2. Choose Register. No client secret is needed: the app is a public client and PKCE proves each sign-in.
3. From the app's Overview, copy the **Application (client) ID** into `apps/worker/.env`:

   ```
   MICROSOFT_CLIENT_ID=...
   ```

4. Under **API permissions**, add the Microsoft Graph delegated permissions `Mail.ReadWrite`, `Mail.Send`,
   `Calendars.Read`, `User.Read` and `offline_access`, and `Tasks.ReadWrite` for Microsoft To Do. This
   only documents what the app asks for; you agree to them when you sign in.
   For Microsoft Teams, also add `Chat.ReadWrite`, `OnlineMeetings.Read` and
   `OnlineMeetingTranscript.Read.All` (see Microsoft Teams below on admin approval).
5. Connect your account. The command asks whether to connect Teams and Microsoft To Do as well, which
   adds their scopes to the sign-in. Microsoft opens in your browser and returns to a one-time address
   on this Mac:

   ```bash
   pnpm connect:microsoft
   ```

6. Restart the worker, since it reads the app from `.env` when it starts.

Microsoft matches a `localhost` redirect without its port, so the one registered address covers the
random port the connect command listens on.

What Microsoft allows: an app from an unverified publisher can be used, but many organisations let only
an administrator approve one. Opening it to other people's work accounts needs Microsoft publisher
verification, and their IT administrators may still have to approve Messages.

Microsoft replaces the refresh token every time the worker refreshes, and each one expires 90 days after
it was issued. The worker keeps the newest in `account_credentials.refreshed`, so an account in use never
expires. One left unused for 90 days does, and `pnpm connect:microsoft` fixes it.

## Linking WhatsApp

Messages joins your WhatsApp as a linked device, the way WhatsApp Web does, using
[Baileys](https://github.com/WhiskeySockets/Baileys). There is no Meta developer account and no setup.

1. Start the worker, which does the linking: `pnpm worker`.
2. In another terminal, run the command below. It asks for the email you sign in to the app with, and
   optionally your WhatsApp number to link with a pairing code instead of a QR code:

   ```bash
   pnpm connect:whatsapp
   ```

3. Within 30 seconds the QR code appears in the terminal, and live in the app under Settings, Accounts,
   WhatsApp. On your phone open WhatsApp, Settings, Linked Devices, Link a Device, and scan it. With a
   pairing code, choose Link With Phone Number Instead and type the code.

The app's WhatsApp page does the same without the terminal: Show QR Code, or Get Pairing Code by phone
number. Both start a link through `link_whatsapp`, which the worker notices on its next 30 second check.

Things to know before linking:

- **The 14-day rule.** WhatsApp keeps a linked device only while your phone comes online at least once
  every 14 days. Otherwise it unlinks Messages, the account shows "Scan the QR code again", and you link
  again. Your phone does not need to be on for day-to-day use.
- **The risk.** Baileys is unofficial. WhatsApp's terms do not allow unofficial clients and it can ban a
  number that uses one. To keep the risk low the worker never sends anything on its own, never sets you
  as online (`markOnlineOnConnect` is off, so your phone keeps getting notifications), sends no typing or
  presence updates, and does not ask for your full history.
- **Unlinking.** Remove Messages on your phone under Linked Devices. Disconnect in the app only pauses
  syncing; the link stays valid for when you reconnect.
- **One worker.** Run only one worker. If a second one connects with the same link, WhatsApp drops the
  first and the account shows a message saying so.

## What it does

### iCloud+ Mail

- Imports the last 30 days from Inbox, Sent and Archive, found by their standard IMAP roles.
- Keeps an IDLE connection on the Inbox, so new mail is stored within seconds. Every folder is also
  checked each minute, in case IDLE misses something.
- Two-way sync. Read, unread, archive and unarchive in the app are applied to iCloud through the
  `mail_actions` queue. Read changes and moves made on other devices reach the app, and a
  conversation whose mail left the Inbox elsewhere is archived.
- Saves its position per folder, so a restart or dropped connection resumes without gaps or duplicates.
- Reconnects with exponential backoff. A rejected password stops retrying and marks the account as
  needing attention, so Apple does not lock it.
- Saves attachment files to the private `attachments` bucket, under your user ID. Files up to 50 MB.
  Mail synced before files were saved is caught up automatically.
- Sends replies queued in the `outbox` table through iCloud's SMTP server, from your account address.
  A reply answers the latest message from someone else. It is filed in Sent and appears in the
  conversation within seconds.
- Logs only IDs, counts and error codes, never message content or addresses.
- Unsubscribes from senders queued in the `unsubscribes` table, using only their List-Unsubscribe
  header: a one-click request where offered (to public addresses only, no redirects followed), else
  an unsubscribe email from your account, else a page for you to open. Links in email bodies are
  never followed. That sender's mail is junk from then on.
- Converts styled Unicode letters (maths bold, script, full-width) to plain text on import.

### Gmail

- Uses the Gmail API with plain HTTPS calls, no Google SDK. Scope `gmail.modify`: read, label, archive
  and send, never permanent deletion.
- Imports the last 30 days, oldest first, using Gmail's own conversation IDs, so threads match Gmail.
  Drafts, spam and the bin are left out. An interrupted first import resumes where it stopped.
- Checks Gmail's change history every 5 seconds, so new mail appears within seconds without Google
  Cloud Pub/Sub. If the history position is more than about a week old, it imports the 30 days again,
  skipping mail it already has.
- Two-way sync through labels. A conversation is in the Inbox while any message has the INBOX label,
  and unread while one has UNREAD. Read, unread, archive and unarchive in the app change those labels
  in Gmail; changes made in Gmail reach the app within seconds. Mail deleted in Gmail stays in the app,
  archived.
- Sends replies through Gmail in the same Gmail conversation, from your Gmail address. Gmail files them
  in Sent. Your send-as aliases count as you, so mail you sent from them shows as yours.
- A revoked or expired sign-in stops retrying and marks the account as needing attention. Run
  `pnpm connect:google` again to fix it.
- Attachments, junk and unsubscribing work as for iCloud. Unsubscribe emails go out through Gmail.

### Google Calendar

- Read-only, scope `calendar.readonly`. Every 5 minutes it fetches events from 7 days ago to 60 days
  ahead, from every calendar ticked in Google Calendar's sidebar, into `calendar_events`.
- Repeating events are stored as individual occurrences. Events cancelled or moved out of the window
  are removed. An event on two calendars is stored once, under your primary calendar when it is there.
- All-day events are stored at midnight UTC with `all_day` set.

### Google Tasks

- Scope `tasks`. Its own `google_tasks` account, made by the same Google sign-in when the Tasks box is
  ticked. Every 3 minutes it reads every task list, asking each only for tasks changed since it was last
  read (kept per list in `sync_state`), into `tasks`. Each list is also read in full after a restart and
  every 6 hours, which removes anything the changes missed.
- Completed and cleared tasks are kept as completed. Deleted tasks and deleted lists are removed.
  Subtasks keep their parent and order in `provider_meta`.
- Google keeps only a due date, never a time, so every task is due all day, at midnight UTC of its date.
- Ticking a task off or back on in the app (`task_updates`) sets its status in Google Tasks.
- If the Google Tasks API is not turned on for your Google Cloud project, the account says so and tries
  again every 15 minutes.

### Google Meet and Chat

- One `google_meet` account on the Google sign-in. Workspace accounts only: a personal account shows
  as needing attention with the reason.
- Meet: every 5 minutes, meetings that ended since the last look (the Meet REST API's conference
  records), with their participants and the transcript's entries, into `meetings` and
  `meeting_participants`. The transcript is JSON segments sealed under `transcript`. Meetings without
  transcription are stored as `no_transcript`; when the recent ones all are, the account says why.
- Chat: every 30 seconds, new messages in your direct messages, group chats and spaces, stored like
  WhatsApp chats (`public.ingest_google_chat`), with people matched by email where Google gives one.
  "Too many requests" slows the polling down. Replies are posted as you; files are not sent yet.

### Outlook

- Uses Microsoft Graph with plain HTTPS calls, no Microsoft SDK. Scopes `Mail.ReadWrite` (read, flag and
  move, never permanent deletion) and `Mail.Send`.
- Imports the last 30 days from the Inbox, Sent Items and Archive, oldest first, fetched as MIME so they
  are stored exactly like iCloud and Gmail mail. Outlook's own conversation ID groups the thread. Drafts
  stay out, and so does mail that is only in Junk or Deleted Items.
- Checks the Inbox's changes (Graph delta queries) every 5 seconds and every followed folder every 20, so
  new mail appears within seconds without Graph's push subscriptions, which need a public web address.
  If Outlook no longer knows a folder's position, that folder starts again from the last 30 days,
  skipping mail it already has.
- Asks Graph for immutable IDs, so a message keeps its ID when it moves folder.
- Two-way sync through folders, like iCloud. Read, unread, archive, delete, junk and their undos in the app
  mark or move the mail in Outlook; delete moves it to Deleted Items. Changes made in Outlook reach the
  app within 20 seconds. Mail moved to a folder of your own, or deleted for good, stays in the app,
  archived. A mailbox without an Archive folder cannot archive from the app.
- Sends replies and new emails from your Outlook address, as MIME so they thread like everywhere else.
  With files, the email is saved as a draft, the files are added (pieces of up to about 4 MB for large
  ones), then it is sent. Up to 20 MB of files per email. Outlook files them in Sent Items, and the sent
  copy is stored at once.
- A revoked or expired sign-in, or one that needs you to sign in again (new consent, MFA, a company
  policy), stops retrying and marks the account as needing attention. Run `pnpm connect:microsoft` to fix
  it.
- Attachments, View Original, junk and unsubscribing work as for Gmail. Unsubscribe emails go out through
  Outlook.

### Outlook Calendar

- Read only, scope `Calendars.Read`. Every 5 minutes it fetches events from 7 days ago to 60 days ahead,
  from every calendar on the account, into `calendar_events`.
- Repeating events are stored as individual occurrences. Events cancelled or moved out of the window are
  removed. A meeting on two calendars is stored once, under your default calendar when it is there.
- Stored exactly like Google events: all-day events at midnight UTC with `all_day` set, answers in
  Google's words, and the organizer listed among the attendees.
- Events made in the app go to Google Calendar or iCloud Calendar, not Outlook.

### Microsoft Teams

- On the Microsoft sign-in, when you answer Yes to Teams in `pnpm connect:microsoft`. It is asked for
  only then, since an organisation that needs an admin to approve Teams would otherwise block Outlook
  too. Needs a work or school account. Its own `teams` account row, like Outlook Calendar's.
- Scopes `Chat.ReadWrite` (read chats, send replies, mark a chat read), `OnlineMeetings.Read` and
  `OnlineMeetingTranscript.Read.All`. The transcript scope needs an IT admin's approval in most
  organisations, and some let only an admin approve any of them. When Microsoft says so, the connect
  command prints an admin consent link; the admin can also use Entra, Enterprise Applications, Messages,
  Permissions, Grant Admin Consent. Answering No to transcripts connects chats only.
- One-to-one, group and meeting chats are stored as conversations (channel `teams`) through
  `public.ingest_teams`, like WhatsApp chats, with people matched by their work address like email.
  Groups are opt-in for AI triage. Message HTML is kept as text and bold and italic runs, like email.
- Polls `/me/chats` every 15 seconds, newest message first, and reads only chats with something new
  since the last check. The first check imports the last 30 days, up to 200 messages a chat. Throttling
  (429) is waited out for as long as Retry-After says. Edits, deletions and reactions in Teams are picked
  up with a chat's next new message.
- Read state: a chat read in Teams is marked read here. A chat is marked read in Teams only when you open
  it in the app, never by Mark as Read or by syncing.
- Replies are posted to the chat. New chats, files and reactions cannot be sent to Teams yet.
- Meetings: every 5 minutes, Teams meetings on your Outlook calendar that have started are found by their
  join link (`/me/onlineMeetings`) and stored in `meetings` as waiting, with their invitees in
  `meeting_participants`. Once a meeting ends its transcript is looked for every 10 minutes for two
  hours, then every 30 minutes until six hours after the end. A transcript is stored as JSON segments,
  status `transcribed`; none by then is `no_transcript`. Speakers who were not invited are added by name.
  Microsoft often shares transcripts only with the meeting's organiser.

### Microsoft To Do

- Optional, scope `Tasks.ReadWrite`, its own `microsoft_todo` account on the same Microsoft sign-in.
- Every 3 minutes it reads every list, then each list's changes with a Graph delta query. The delta link
  is kept per list in `sync_state` (scope `todo:<list id>`). Tasks deleted in To Do, and lists that are
  gone, are removed. If Graph no longer knows a list's delta link, that list is read again in full.
- Stored in `tasks` with the title, notes (as plain text) and list name sealed. High importance is
  priority 1, low is 3, normal is none.
- Due dates are days: stored at midnight UTC with `due_all_day` set. Graph often writes a due date as
  your midnight in UTC (`22:00` UTC the day before, in South Africa), so a time that is not midnight in
  its own zone is read as the nearest midnight in your profile's time zone. A reminder on the due day
  makes the task due at that time instead.
- Ticking a task off, or back on, in the app sets it to completed or not started in To Do.
- When Graph keeps throttling, the next try waits as long as its Retry-After asks, up to 15 minutes.

### iCloud Calendar

- Over CalDAV with an app-specific password. Connect it with `pnpm connect:icloud-calendar`,
  which can reuse the sign-in saved for iCloud+ Mail. The sign-in is the Apple ID, which is not always
  the address iCloud+ Mail is set up with.
- Every 5 minutes it checks each calendar's change marker (`getctag`) and, when any changed, fetches
  events from 7 days ago to 60 days ahead from every calendar, into `calendar_events`. A full fetch runs at
  least hourly regardless.
- iCloud expands repeating events into individual occurrences. Events cancelled or moved out of the window
  are removed. A meeting on two calendars is stored once, under the first calendar iCloud lists.
- Reminder lists and subscribed calendars (public holidays, birthdays) are skipped. Times with a zone are
  converted to UTC; a time with no zone is read as UTC.
- Events made in the app are added to the first event calendar iCloud lists, as a new file with
  `If-None-Match: *`, so an existing event is never replaced; nothing already in iCloud is changed or
  deleted. Times are sent in UTC and all-day events as dates. Guests are invited by iCloud from the address
  it knows the account by; with Send Invites off they are marked `SCHEDULE-AGENT=CLIENT`, which asks iCloud
  not to email them. Add Google Meet does not apply. A request that may have reached iCloud (a timeout, a
  server error) is never sent again: its row fails with a warning to check the calendar.
- The sign-in is only ever sent to `*.icloud.com`.

### iCloud Reminders

- This worker does not run iCloud Reminders. Upgraded Reminders lists are not on CalDAV since iOS 13, so the
  AI worker's connector (`python3 -m ai icloud-reminders`, in `apps/ai`) signs in to iCloud.com with the Apple ID
  entered in Settings, Connected Accounts, iCloud Reminders, and syncs the lists and settles ticks made in the
  app (`task_updates`). The worker leaves `icloud_reminders` accounts alone.

### WhatsApp

- The session (credentials and Signal keys) lives in `whatsapp_auth_keys`, each value encrypted with
  `ENCRYPTION_KEY` and written the moment it changes. When WhatsApp unlinks the device the session is
  deleted and the account is set to need attention.
- Imports the history your phone sends when the device links (recent chats, not your full history).
  Chats unread on the phone stay unread, and chats archived on the phone start archived.
- One conversation per chat. Groups get their name and have AI triage off until you turn it on.
- People get `phone` and `whatsapp` identities in E.164 (`+447700900123`). WhatsApp increasingly hides
  numbers behind privacy IDs (`...@lid`); such a person is stored by that ID and gains their number, and
  their chat moves to it, as soon as WhatsApp reveals it.
- Names: the chat name from your phone, else the name saved in your iCloud or Google Contacts (see
  Photos and Names below), else the name the person set for themselves. Your phone does not share its
  address book with linked devices, so someone you have not saved shows by their own name or number.
- Text, captions, locations, contacts, polls, group invites and business messages become text. A quoted
  reply keeps what it quotes in `provider_meta.quoted` (`id`, `author`, `from_me`, `text`), shown as a
  quote block. Mentions show the person's name. Reactions are kept on the message they react to in
  `provider_meta.reactions`. Edits replace the text, and deleted messages read "This message was
  deleted." A message type not handled yet says to open WhatsApp, and its type is logged.
- Photos, videos, voice notes, documents and stickers are saved to the private `attachments` bucket, like
  email attachments, for new messages and for history from the last 30 days (stickers at any age).
  WhatsApp deletes its copy of older files and old links expire; the phone is then asked to upload them
  again (it must be online). A file that still
  fails is retried every 10 minutes, up to three times per worker run.
- Replies can carry up to 10 files of 50 MB each. WhatsApp itself takes 100 MB, but files are uploaded
  through Supabase Storage, and the Free plan stops at 50 MB. Each file goes as its own message: JPEG
  and PNG photos and MP4 videos inline, audio as audio, anything else as a document, with your text as
  the first one's caption. If a later file fails, the reply is marked with how many parts went out.
- New chats are outbox rows with no conversation, the account, and one number in E.164 in
  `to_addresses`. The number is checked with WhatsApp first ("This number is not on WhatsApp."
  otherwise), an existing chat with it is continued, and once sent the row points at the chat.
- Replies can quote a chosen message (`outbox.reply_to_message_id`). Reactions you add in the app are
  queued as `react` rows in `mail_actions` and sent only then; an empty emoji removes yours.
- Profile pictures of the people and groups in your chats are fetched one at a time, two seconds apart,
  and checked again weekly. A photo from your own address book is never replaced by one.
- Read receipts are never sent automatically. Opening an unread chat in the app queues a `read` row in
  `mail_actions`; only then, and only with WhatsApp Read Receipts on in Settings, does WhatsApp get blue
  ticks for those messages. Chats you read on your phone become read in the app.
- Replies queued in the outbox for a WhatsApp chat are claimed, sent over the link, and recorded as sent
  or failed, never twice. While the link is reconnecting they wait in the queue. A send that errors is
  failed with "Check WhatsApp before sending again", since it may have gone out.
- Voice notes recorded in the app's reply box are converted with ffmpeg to mono Ogg Opus, with their
  length and waveform, and sent as WhatsApp voice notes. ffmpeg must be on the PATH (`brew install
  ffmpeg` on a Mac); the audio goes through pipes and never touches the disk. Without ffmpeg, a voice
  note fails with "Try recording it again" and nothing is sent.
- Logs IDs, counts and status codes only. Baileys' own logging is off, because it includes message
  content and numbers; only its fixed app state sync status lines are kept. libsignal prints whole
  encryption sessions to the console, keys included, so those lines are dropped.

### Photos and names from your address books

- Once a day, and two minutes after the worker starts, your iCloud Contacts (CardDAV, with the iCloud
  app-specific password) and Google Contacts (People API) are matched to the people in Messages by email
  address, then by phone number (the last nine digits, so local and international forms match). A card
  that matches more than one person is skipped rather than guessed.
- Their photos become the contact's photo in the private `avatars` bucket, ahead of WhatsApp profile
  pictures. Their saved names replace names that are still a bare number, never a real name.
- Google Contacts needs the `contacts.readonly` scope, which sign-ins from before it was added lack. Run
  `pnpm connect:google` again and leave the contacts box ticked. Until then Google is skipped.

## Not yet

- Reply All, new emails, and attachments on replies you send.
- Pinning is app-only. iCloud has no equivalent, and Gmail stars are not synced.
- Replies from a Gmail alias: replies always go from your main Gmail address.
- The briefing and triage do not read `calendar_events` yet.
- Outlook: contact photos and names from Outlook contacts, sending from other addresses on the account,
  and creating events in Outlook Calendar.
- WhatsApp: status updates, calls and channels.
