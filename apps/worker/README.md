# Sync worker

The always-on service that keeps your accounts in sync with Supabase. It handles iCloud+ Mail, Gmail,
Google Calendar and WhatsApp.

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

Gmail and Google Calendar share one Google sign-in. Google needs an OAuth client of your own first.
This is a one-time setup in Google Cloud, about ten minutes.

1. At [console.cloud.google.com](https://console.cloud.google.com), create a project named Messages.
2. Under APIs and Services, then Library, enable the **Gmail API** and the **Google Calendar API**.
3. Open **Google Auth Platform** and choose Get Started:
   - App name: Messages. Support email and contact email: your own address.
   - Audience: **External**. If your Gmail is a Google Workspace account you manage, choose
     **Internal** instead; there is then no unverified-app warning and nothing to publish.
4. Under **Audience**, choose **Publish App** so the status reads In Production. Leave it unverified.
   An External app left in Testing has its sign-in expire every 7 days, which would stop sync weekly.
5. Under **Data Access**, add the scopes `https://www.googleapis.com/auth/gmail.modify`,
   `https://www.googleapis.com/auth/calendar.readonly` and
   `https://www.googleapis.com/auth/contacts.readonly` (names and photos of your contacts). This only
   documents what the app asks for.
6. Under **Clients**, create a client with application type **Desktop app**, named Messages Worker.
   Copy its client ID and secret into `apps/worker/.env`. Google shows the secret only once.

   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

7. Connect your account. Google opens in your browser and returns to a one-time address on this Mac.
   It warns that Google has not verified the app; choose Advanced, then Go to Messages. Leave both
   boxes ticked:

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
- WhatsApp: status updates, calls and channels.
