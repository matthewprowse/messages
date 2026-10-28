# konva-linkedin

A small program that speaks to LinkedIn's messaging for one account, and nothing else. It uses
`pkg/linkedingo` from [mautrix-linkedin](https://github.com/mautrix/linkedin) (pinned in `go.mod`), and
like it is licensed under the GNU Affero General Public License v3 (see `LICENSE`). It is a separate
program: it does not import or embed any Konva code, and Konva does not link it in. Konva's sync worker
runs it as a child process and talks to it over stdin and stdout.

It stores nothing, logs nothing and sends nothing it was not told to. Storage, encryption, account status,
back-off and deciding what to send all live in the worker (`apps/worker/src/connectors/linkedin.ts`).
Signing in with an email and password is done here, with linkedingo's password login, but where the
password and the session are kept, and what the person is asked at each check, is the worker's job too.

## Build and test

Needs Go 1.26 or newer (the version mautrix-linkedin requires).

```bash
pnpm linkedin:build      # go build -o bin/konva-linkedin . (from the repo root)
cd apps/linkedin && go test ./...
```

The worker looks for the program at `apps/linkedin/bin/konva-linkedin`, or at `LINKEDIN_HELPER` in
`apps/worker/.env`.

`go.mod` pins mautrix-linkedin at a commit on its main branch (`48d3d83`, 26 October 2026), because
the password login (`linkedingo.NewPasswordLoginClient`) and `Client.SetBrowserHeaders` are not in a release
yet. After changing the pin, run `go mod tidy` once, which also fills in `go.sum`.

## Protocol

One JSON object per line, UTF-8, in both directions. The worker sends commands on stdin; the program
answers each with one response on stdout, in order, and also writes events on stdout whenever they
happen. Closing stdin ends the program.

### Commands

```json
{"id": 1, "cmd": "login", "args": {"cookies": "li_at=...; JSESSIONID=\"ajax:...\"", "xLiTrack": "", "pageInstance": "", "syncToken": ""}}
```

| Command | Args | Result |
| --- | --- | --- |
| `signin` | `email`, `password`, optional `proxy` (an `http`, `https` or `socks5` URL the sign-in goes through) | A [sign-in result](#sign-in-results). Starts a password sign-in. |
| `code` | `code` (six digits) | A sign-in result. Answers a `code` state. |
| `app` | none | A sign-in result, once the sign-in is approved in the LinkedIn app, turned down or timed out. Answered later, so other commands still run while it waits. |
| `another_way` | none | A sign-in result. Ends a wait for approval in the app and asks LinkedIn for another way (a code). |
| `login` | `cookies` (a Cookie header with at least `li_at` and `JSESSIONID`), optional `headers` (the browser headers the cookies were created with, as a map of lists), `xLiTrack`, `pageInstance` and `syncToken` | `{"me": Person}`. Checks the session with one request, with those headers. Must come first for everything below. |
| `conversations` | optional `before` (Unix ms; default now) | `{"conversations": [Conversation]}`: up to 20 updated before then, newest first |
| `changes` | none | `{"conversations": [Conversation], "deleted": [urn], "syncToken": "..."}`: what changed since the sync token |
| `messages` | `conversation` (URN), optional `before` (Unix ms), `count` (1 to 40, default 20) | `{"messages": [Message]}` |
| `send` | `conversation`, `text`, `token` (a unique ID, so a retried request is one message), optional `attachments` (see [Files](#files)); `text` may be empty when there are files | `{"message": Message}`; with files also `"messages": [Message]`, one per file |
| `start` | `profile` (a profile URN, a `linkedin.com/in/` URL, a public identifier or a name), `text`, `token`, optional `attachments` (see [Files](#files)) | `{"conversation": Conversation, "message": Message}`: the first message of a new conversation with one member. A URN is used as it is; anything else is looked up in LinkedIn's messaging search and must match exactly one person's full name, else `not_found` or `ambiguous` and nothing is sent. |
| `picture` | `url` (a Person's `picture`) | `{"data": "<base64>", "type": "image/jpeg"}`. Fetches a profile picture without the session's cookies, through the proxy of the helper's environment. Only `https://*.licdn.com` addresses, only `image/*`, at most 2 MB and no redirects; anything else is `bad_request` or `failed`. |
| `read` | `conversation` | `{}`: marks it read on LinkedIn |
| `connect` | none | `{}`: starts the real-time stream; its events follow |
| `stop` | none | `{}`, then the program exits |

### Responses

```json
{"id": 1, "ok": true, "result": {"me": {"id": "ACoAA...", "urn": "urn:li:fsd_profile:ACoAA...", "kind": "member", "firstName": "...", "lastName": "..."}}}
{"id": 2, "ok": false, "error": {"kind": "rate_limited", "status": 429}}
```

Error kinds: `bad_credentials` (the session is not valid: reconnect), `rate_limited` (429),
`refused` (LinkedIn's 999), `forbidden` (403), `bad_request` (a command that could not run, including
anything before `login`), `not_found` and `ambiguous` (a `start` whose profile matched nobody, or several people),
`partial` (a send of several files that stopped after `sent` of its messages went out), `failed` (anything else). An error never carries what LinkedIn said.

A sign-in adds `rejected` (the password or a code was not accepted), `blocked` (turned away), `challenge`
(a check Konva cannot complete, such as a CAPTCHA), `unavailable` (LinkedIn could not be reached),
`unsupported` (LinkedIn's sign-in page is not one the library understands) and `cancelled` (an `app` wait
that another command ended). These can carry `stage`, a fixed label from linkedingo such as
`authenticate` or `app_approval_expired`.

### Sign-in results

`signin`, `code`, `app` and `another_way` answer with one of these, in `result`:

```json
{"state": "done", "cookies": "li_at=...; JSESSIONID=...", "headers": {"User-Agent": ["Mozilla/5.0 ..."]}}
{"state": "code", "method": "email"}
{"state": "code", "method": "totp", "rejected": true}
{"state": "app", "canTryAnotherWay": true}
```

`done`: signed in. Keep the cookies and headers and pass both to `login` from then on, so the session keeps
the User-Agent it was created with. `code` (`method` is `email`, `sms` or `totp`): LinkedIn wants a six
digit code, sent with `code`; `rejected` means the last one was wrong. `app`: LinkedIn wants the sign-in
approved in its app; send `app` to wait for it (or `another_way`). The helper keeps the sign-in between
commands, so they go to the same process, and none of them logs the password or a code.

### Events

```json
{"event": "ready"}
{"event": "connected"}
{"event": "heartbeat"}
{"event": "reconnecting"}
{"event": "message", "message": Message}
{"event": "conversation", "conversation": Conversation}
{"event": "bad_credentials", "error": {"kind": "bad_credentials"}}
{"event": "failed", "error": {"kind": "failed"}}
```

`ready` comes once at start. `connected`, `heartbeat`, `reconnecting`, `message` and `conversation`
come from the real-time stream after `connect`. `bad_credentials` and `failed` mean the stream stopped
for good.

### Files

`attachments` is a list of up to 10 files, each `{"path", "name", "mime", "kind"}`. The worker writes them
to a private folder under the temp folder and the helper reads them from there, on the same machine: `path`
must be absolute and, with links followed, a regular, non-empty file under `os.TempDir()` (at most 100 MB),
or the whole command is `bad_request` and nothing is uploaded. `kind` is `image`, `video` or `file`, which
picks LinkedIn's upload type the way the mautrix bridge does (images go up as photo attachments and are sent
as files). Every file is a message of its own, the `text` with the first. The first message's token is `token`
and the others are derived from it, so a retried send is the same messages. For `start`, the first file
opens the conversation with the text and the rest follow in it (the other messages are in `conversation.messages`).
If a send stops after some messages went out, the answer is the error `partial` with `sent` set to how many
did; the worker must not send the rest again without asking.

### Shapes

- **Person**: `id` (the last part of the URN), `urn` (`urn:li:fsd_profile:<id>` for a member, the
  company's URN for a page), `kind` (`member` or `organization`), and `firstName`, `lastName`,
  `headline` for a member or `name` for a page, and `picture` when there is one: the address of the
  largest profile picture or logo, signed and expiring, for the `picture` command and for nothing else.
- **Message**: `urn`, `conversationUrn`, `sender` (Person), `deliveredAt` (Unix ms), `text`, `format`
  (`DEFAULT`, `EDITED`, `RECALLED` or `SYSTEM`) and `files` (`name`, `mediaType`, `size`; the files
  themselves are not fetched).
- **Conversation**: `urn`, `title`, `group`, `read`, `lastActivityAt`, `lastReadAt`, `categories`
  (such as `INBOX`, `ARCHIVE`, `SPAM`), `participants` (Person, you included) and the `messages`
  LinkedIn sent with it.
