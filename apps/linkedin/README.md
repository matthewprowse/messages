# konva-linkedin

A small program that speaks to LinkedIn's messaging for one account, and nothing else. It uses
`pkg/linkedingo` from [mautrix-linkedin](https://github.com/mautrix/linkedin) (pinned in `go.mod`), and
like it is licensed under the GNU Affero General Public License v3 (see `LICENSE`). It is a separate
program: it does not import or embed any Konva code, and Konva does not link it in. Konva's sync worker
runs it as a child process and talks to it over stdin and stdout.

It stores nothing, logs nothing and sends nothing it was not told to. Signing in, storage, encryption,
account status, back-off and deciding what to send all live in the worker
(`apps/worker/src/connectors/linkedin.ts`).

## Build and test

Needs Go 1.26 or newer (the version mautrix-linkedin requires).

```bash
pnpm linkedin:build      # go build -o bin/konva-linkedin . (from the repo root)
cd apps/linkedin && go test ./...
```

The worker looks for the program at `apps/linkedin/bin/konva-linkedin`, or at `LINKEDIN_HELPER` in
`apps/worker/.env`.

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
| `login` | `cookies` (a Cookie header with at least `li_at` and `JSESSIONID`), optional `xLiTrack`, `pageInstance` and `syncToken` | `{"me": Person}`. Checks the session with one request. Must come first. |
| `conversations` | optional `before` (Unix ms; default now) | `{"conversations": [Conversation]}`: up to 20 updated before then, newest first |
| `changes` | none | `{"conversations": [Conversation], "deleted": [urn], "syncToken": "..."}`: what changed since the sync token |
| `messages` | `conversation` (URN), optional `before` (Unix ms), `count` (1 to 40, default 20) | `{"messages": [Message]}` |
| `send` | `conversation`, `text`, `token` (a unique ID, so a retried request is one message) | `{"message": Message}` |
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
anything before `login`), `failed` (anything else). An error never carries what LinkedIn said.

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

### Shapes

- **Person**: `id` (the last part of the URN), `urn` (`urn:li:fsd_profile:<id>` for a member, the
  company's URN for a page), `kind` (`member` or `organization`), and `firstName`, `lastName`,
  `headline` for a member or `name` for a page.
- **Message**: `urn`, `conversationUrn`, `sender` (Person), `deliveredAt` (Unix ms), `text`, `format`
  (`DEFAULT`, `EDITED`, `RECALLED` or `SYSTEM`) and `files` (`name`, `mediaType`, `size`; the files
  themselves are not fetched).
- **Conversation**: `urn`, `title`, `group`, `read`, `lastActivityAt`, `lastReadAt`, `categories`
  (such as `INBOX`, `ARCHIVE`, `SPAM`), `participants` (Person, you included) and the `messages`
  LinkedIn sent with it.
