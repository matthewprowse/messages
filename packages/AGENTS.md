# packages

Small shared libraries, imported as `@messages/<name>` by the web app and the worker. Read `../AGENTS.md` first.

| Package | Purpose | Notes |
| --- | --- | --- |
| `crypto` | AES-256-GCM field encryption, blind indexes, key derivation. | Format pinned by `vectors.json`; `apps/ai/ai/crypto.py` mirrors it. Change both together. |
| `db` | Generated Supabase types. | Regenerate with `pnpm --filter @messages/db gen:types`; never edit `database.types.ts`. |
| `email-text` | Email HTML and quoted-reply parsing to plain text. | Pure; heavily tested. |
| `mail-servers` | IMAP and SMTP discovery and probing. | |
| `analytics` | Event names and property types for content-free analytics. | Add an event here before using it in the app. |
| `qr` | QR code to SVG path. | |

Rules: a package has no dependency on an app; it exports through `src/index.ts` (plus named subpaths listed in
`package.json` `exports`); it has its own `typecheck` and, where it has logic, `test` script.
