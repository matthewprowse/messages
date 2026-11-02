# Connector Setup (Developers)

One-time provider setup for whoever runs a Konva server, and the terminal commands that connect an account while
developing. This used to be shown inside Settings. People using the app connect their accounts in the web page only
(Settings, Connected Accounts); none of this belongs in the product.

Keys and `.env` files are never committed. Each variable is documented in the matching `.env.example`.

## Terminal Commands

Run from the repo root, with `pnpm worker` running or restarted afterwards so it picks the account up.

| Command | Connects |
| --- | --- |
| `pnpm connect:google` | Gmail, Google Calendar and Google Tasks, and Meet and Chat when you choose them |
| `pnpm connect:microsoft` | Outlook, Outlook Calendar, Microsoft To Do and Teams |
| `pnpm connect:icloud` | iCloud Mail (an app-specific password from account.apple.com, Sign-In and Security) |
| `pnpm connect:icloud-calendar` | iCloud Calendar with the same app-specific password |
| `pnpm connect:imap` | Any IMAP and SMTP mailbox. It finds the server settings or lets you type them in |
| `pnpm connect:whatsapp` | Links WhatsApp as a linked device. The QR code shows in the terminal |

## Google

1. At console.cloud.google.com, create a project and name it Messages.
2. Under APIs and Services, then Library, enable the Gmail API, the Google Calendar API and the Google Tasks API.
3. Meet and Chat (Google Workspace accounts only): also enable the Google Meet REST API and the Google Chat API. Open
   the Google Chat API's Configuration tab, give the Chat app a name, an avatar URL and a description, turn off
   Interactive Features, and save. Chat refuses every request until this is done. Transcripts also need a Workspace
   plan with Meet transcription, turned on in each meeting.
4. Open Google Auth Platform and choose Get Started. Name the app, use your own email for support and contact, and
   choose External. Under Audience, choose Publish App so it says In Production. An app left in Testing signs people
   out every 7 days.
5. Under Clients, create a client with the application type Desktop App. Copy the client ID and secret into
   `apps/worker/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Google shows the secret only once.
6. Run `pnpm connect:google` if connecting from the terminal. Google warns the app is not verified because it is your
   own: choose Advanced, then Go to the app. Leave every box ticked, including Google Tasks.
7. Restart `pnpm worker`. It reads the client from `.env` when it starts. Gmail then imports the last 30 days.

## Microsoft

1. At entra.microsoft.com, open App Registrations and choose New Registration. Name it Konva. Under Supported Account
   Types, choose Accounts in Any Organizational Directory and Personal Microsoft Accounts.
2. Under Authentication, add a platform: Mobile and Desktop Applications (Public Client/Native). Add both redirect
   addresses: `http://localhost` for the worker and `<your app address>/api/connect/microsoft/callback` for the web
   page. Microsoft needs the second to match exactly. No client secret is needed.
3. Under API Permissions, add these Microsoft Graph delegated permissions: Mail.ReadWrite, Mail.Send, Calendars.Read,
   Tasks.ReadWrite, User.Read and offline_access. For Teams, also add Chat.ReadWrite, OnlineMeetings.Read and
   OnlineMeetingTranscript.Read.All. Many organisations let only an IT admin approve the Teams ones; the web page then
   shows a link for the admin.
4. Copy the Application (Client) ID into both `apps/web/.env.local` and `apps/worker/.env` as `MICROSOFT_CLIENT_ID`.
   Set `MICROSOFT_TENANT` in both only to limit sign-in to one organisation. Restart the app and the worker.

## Zoom

1. At marketplace.zoom.us, choose Develop, then Build App, and pick General App. Under Basic Information, choose
   User-Managed, so each person signs in with their own Zoom account.
2. Under OAuth Information, set `http://localhost:3000/api/connect/zoom/callback` as the OAuth Redirect URL and add it
   to the OAuth Allow List. On a server, use its own address in place of `http://localhost:3000`.
3. Under Scopes, add user:read:user, cloud_recording:read:list_user_recordings, meeting:read:meeting,
   meeting:read:list_past_participants, team_chat:read:list_user_sessions, team_chat:read:list_user_messages and
   team_chat:write:user_message. To read Team Chat, also turn on Team Chat under Features, then Surface.
4. From App Credentials, copy the client ID and secret into `apps/web/.env.local` and `apps/worker/.env` as
   `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET`. Restart the app.
5. Transcripts come from cloud recordings, which need a paid Zoom plan. In Zoom, open Settings, then Recording, and turn
   on Cloud Recording and Create Audio Transcript. Meetings recorded without a transcript are transcribed from their
   audio instead.
6. Restart `pnpm worker`. Team Chat imports the last 30 days and is checked every minute; recorded meetings are checked
   every 10 minutes.

## WhatsApp

`pnpm connect:whatsapp` links from the terminal, with the QR code printed there. In the app, Settings, Connected
Accounts, Link WhatsApp shows the same QR code in the web page, which is what people use. WhatsApp keeps a linked device
only while the phone comes online at least once every 14 days.
