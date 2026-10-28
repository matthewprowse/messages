# apps/web

The Next.js app (App Router, React 19, Tailwind 4, shadcn/ui). Read `../../AGENTS.md` and `../../docs/CONVENTIONS.md` first.

## Layout

| Path | Contents |
| --- | --- |
| `app/<route>/page.tsx` | One folder per screen: `inbox`, `calendar`, `contacts`, `notes`, `attachments`, `summary`, `settings/*`, `updates`, `analytics`, `admin`, `invite`, `login`, `more`. Pages stay thin: they compose components and read the store. |
| `app/api/` | Server routes: `connect/*` (OAuth callbacks and connector set up) and `keys`. |
| `components/` | Feature components, flat by feature (`thread-view.tsx`, `note-editor.tsx`), plus feature folders (`calendar/`, `settings/`, `onboarding/`, `admin/`, `analytics/`, `updates/`). |
| `components/ui/` | Stock shadcn primitives. Do not restyle; compose them. |
| `lib/store.tsx` | `AppProvider` and `useApp()`: the one client store (threads, messages, contacts, tasks, rules, drafts, compose). |
| `lib/app-store/` | The store's parts: `reducer.ts` (state and actions), `context.ts` (the `Ctx` type), `thread-filters.ts`, `compose.ts`, `draft-helpers.ts`, `telemetry.ts`, `task-follow.ts`, `use-realtime.ts`. |
| `lib/data.ts` | Loading rows from Supabase and mapping them to app types (`mapThread`, `mapMessage`, ...). |
| `lib/types.ts` | The app's own types (`Thread`, `Message`, `Contact`, ...). Not the database types. |
| `lib/vault.ts`, `lib/open-rows.ts`, `lib/address-refs.ts` | Sealing and opening encrypted columns in the browser. |
| `lib/server/` | Server-only helpers for API routes (provider OAuth, key wrapping). Never import from client code. |
| `middleware.ts` | Per-request CSP nonce. |

## Working here

- Read data through `useApp()`; do not query Supabase from a component except for one-off screens that already do.
- Anything that touches an encrypted column goes through `vault.ts` / `open-rows.ts`. Never write plaintext message text.
- A change the user makes shows at once (optimistic) and is saved after; on failure put it back and show a toast.
- Track usage with `track()` from `lib/analytics.ts`, with counts and enums only, never content.
- Logic worth testing goes in `lib/*.ts` with a `*.test.ts` beside it. `pnpm --filter web test` runs `lib/**/*.test.ts`.
- Do not run `next build` while the user's dev server is running: both write to `.next`. Use `pnpm typecheck` and the dev server.
