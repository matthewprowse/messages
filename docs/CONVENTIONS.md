# Conventions

How code, comments and files are written here, so any agent or person can read any file and know what it is for.
`AGENTS.md` links here. If you change a rule, change it here and nowhere else.

## File header (every source file)

The first thing in every `.ts`, `.tsx` and `.py` file says what the file is for, in one to four lines. A reader should
know from the header alone whether this is the file they want.

- **TypeScript:** a `//` comment block at the very top. In a file with a `"use client"` or `"use server"` directive the
  directive stays on line 1 and the header goes directly under it, after one blank line.
- **Python:** a module docstring (`"""..."""`) before the imports.
- **Tests:** the header names the module under test and what it pins down.
- **Not required:** generated files (`database.types.ts`), `components/ui/*` (stock shadcn), JSON, CSS and SQL
  (SQL migrations start with a `--` comment saying what changes and why).

A good header says what the file is, and what it is not or who uses it when that is not obvious:

```ts
// Turns a Gmail history record into label changes. Pure: no network, no database. The Gmail connector
// (connectors/gmail.ts) calls it for every history page.
```

```python
"""Triage: priority, category, junk and a one-line summary for each new incoming message.

Your own signals win over the model: priority rules, unsubscribed senders and your corrections."""
```

## Doc comments

- Every exported function, type, component and constant gets a one-line doc comment unless its name and type already say
  everything. TypeScript uses `/** ... */`; Python uses a docstring.
- Describe the contract: what it returns, what happens on failure, what the caller must know. Do not restate the name.
- Parameters are documented only when a value is not obvious (units, "undefined means all", "E.164 number").

## Inline comments

- Explain **why**: a constraint, a provider quirk, an ordering that matters, a past bug. Never narrate what the next line does.
- Put a unit on every magic number (`30_000, // ms`) or name it as a constant with a comment.
- Mark a section of a long function with a short `// ...` line above the block, not a banner.
- `TODO` comments name what is missing and why it waits: `// TODO: page through results; Graph caps at 50.`
- Delete commented-out code. Git remembers it.
- Do not put em dashes or en dashes in comments, strings or docs. Use a comma, a colon or a new sentence.

## Files and folders

- One concern per file, named for it in kebab-case (`gmail-labels.ts`, `team-voice.tsx`). Python uses snake_case.
- A file grows to about 400 lines before it needs a reason; at 600 split it. Split by concern (types, pure logic, I/O,
  view), not by arbitrary line count.
- Pure logic (parsing, mapping, rules, layout) lives in plain modules with no network or database imports, so it can be
  tested without setup. I/O lives in thin modules that call it.
- A folder of related modules is named for the feature (`app-store/`, `components/calendar/`, `worker/src/google/`) and
  has no `index.ts` barrel unless it is a package entry point. Import the module you need directly.
- React components: one main component per file; small private helpers may sit beside it. Hooks that carry
  non-trivial logic get their own `use-*.ts` file.
- Types shared between modules live next to the data they describe (`lib/types.ts`, `app-store/context.ts`), not in a
  catch-all `types` folder.

## Names

- Functions are verbs (`loadThread`, `mapMessage`, `sealAddress`); values and types are nouns.
- Predicates read as questions (`isOverdue`, `mayPreDraft`).
- Database rows map to app types through `mapX` functions; the reverse is `xWriteFields` or `xPatch`.
- Constants that are limits or timings end in their unit (`DRAFT_TIMEOUT_MS`, `PRE_DRAFT_DAYS`).

## Tests

- TypeScript uses the built in `node:test` and `node:assert/strict`, run by `tsx --test`. Python uses `unittest`.
- A test name is a sentence about behaviour: `a run of UIDs becomes a range, a lone one stays alone`.
- Test files are named `<module>.test.ts` and sit beside the module. Python tests are `apps/ai/tests/test_<module>.py`.
- Never contact a real provider from a test. Pass fakes in through parameters, as the existing tests do.

## Errors and logging

- Return or throw errors with a stable `code` (`HTTP_429`, `invalid_grant`); callers branch on the code, users see a
  plain sentence written for them.
- Logs are structured (`log.warn("zoom participants failed", { account, code })`) and never contain message text,
  names, addresses or tokens.
