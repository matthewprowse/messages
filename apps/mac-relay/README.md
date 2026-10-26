# Konva Relay

A small Mac app that syncs iCloud Reminders with Konva. It reads your reminders with EventKit, Apple's own
access to Reminders, sends them to the Konva worker, and ticks reminders off or back on when you do that in
Konva. iCloud then passes those changes to your iPhone.

## Why a Mac app

Since iOS 13, upgraded Reminders lists are no longer served over CalDAV. iCloud's CalDAV server still lists a
reminder list or two, but those are frozen copies from before the upgrade: new reminders never appear in them.
The only other way in is the private web API that icloud.com uses, which needs your Apple ID password and a
two-factor code, gives whoever holds the session your whole iCloud account (mail, files, photos, devices), and
stops working with Advanced Data Protection on. Konva does not ask for that.

EventKit on a Mac sees every list iCloud syncs to it, upgraded and shared lists included, with no password at all.

## What you need

- A Mac on macOS 14 or later, signed in to the same Apple ID as your iPhone, with Reminders turned on in
  System Settings, your name, iCloud.
- The Mac left on and awake. The screen can sleep. When the Mac is off nothing syncs, and ticking a reminder
  off in Konva fails with a reason rather than waiting.
- Xcode or the Xcode command line tools, to build it.
- The Konva worker running with `RELAY_PORT` set (see below).

## Set up

1. In Konva, open Settings, Connected Accounts, iCloud Reminders, and choose Create Relay Token. Keep the page
   open: the token is shown once.
2. On the Mac, from this folder:

   ```sh
   make install   # builds Konva Relay.app into ~/Applications
   make setup     # asks for the relay address and token, and checks them with Konva
   make agent     # starts it now and at every login
   ```

3. Allow Konva Relay to access Reminders when macOS asks. If you missed the prompt, allow it in System
   Settings, Privacy and Security, Reminders.

`make status` shows the last sync. `make uninstall` stops it, removes the pairing and deletes the app.

### The worker side

In `apps/worker/.env`:

```sh
RELAY_PORT=8790
RELAY_HOST=127.0.0.1
```

The worker then listens on `http://localhost:8790` on its own machine only. That is enough when the worker
runs on the same Mac. When it runs elsewhere, put a TLS proxy in front of it, set `RELAY_HOST=0.0.0.0` behind
the proxy, and set `RELAY_PUBLIC_URL` in `apps/web/.env.local` to the proxy's https address, so the setup page
shows it. The relay refuses plain http to anywhere but this Mac.

## What it does

- Every change in Reminders, on the Mac or arriving from iCloud, starts a sync a few seconds later. A sync also
  runs every 5 minutes regardless.
- A sync sends every open reminder, and every one completed in the last 30 days, from every list: title, notes,
  due date or time with its zone, priority (EventKit's 0 to 9), completed and when, and the list's name. Konva
  stores it encrypted when content encryption is on, and removes what is no longer there.
- It keeps a request open to the worker (a long poll of up to 25 seconds), so a tick in Konva reaches Reminders
  within a second or two. It applies the change, reports back, and syncs again.
- Nothing else is ever changed: no reminder is created, edited or deleted.

## Security

- The token is made by Konva and shown once. The worker stores only its SHA-256, so it cannot be read back.
  It lets the relay write to your own reminders in Konva and nothing else: the token alone decides the
  account, never anything in a request. Making a new token, or pausing sync, stops the old one within seconds.
- The worker limits each token to 120 requests a minute and 20 syncs a minute, caps a sync at 8 MB and
  20,000 reminders, and limits wrong tokens by address.
- On the Mac the token is kept in `~/Library/Application Support/Konva Relay/config.json`, readable by your
  macOS user only (like an SSH key). Requests are never redirected, and nothing is cached on disk.
- Its log (`~/Library/Logs/Konva Relay.log`) has counts and codes only, never reminder text.

## Protocol

Version 1, JSON over HTTPS, `Authorization: Bearer <token>` on every request. The worker's side is
`apps/worker/src/reminders/`.

| Request | Body or reply |
| --- | --- |
| `POST /v1/reminders/sync` | `{ version: 1, access: "full" or "denied", timeZone, lists: [{ id, name }], reminders: [{ id, listId, title, notes?, due?: { date, time?, timeZone? }, completed, completedAt?, priority }] }` |
| `GET /v1/reminders/updates?wait=25` | `{ updates: [{ id, reminderId, action: "complete" or "reopen" }] }` |
| `POST /v1/reminders/updates/<id>` | `{ ok: true }` or `{ ok: false, error: "not_found", "read_only", "denied" or "save_failed" }` |

A reminder's `id` is iCloud's own (`calendarItemExternalIdentifier`), the same on every device, else the
Mac's local id.

## Development

```sh
swift build
swift test     # the protocol and mapping in RelayCore, no Reminders access needed
```

Rebuilding changes the ad hoc signature, so macOS may ask for Reminders access again after `make install`.
