// The browser tests' settings, read from apps/web/.env.test.local and checked before anything runs, so a run can only
// ever reach the Konva Test database (docs/TESTING.md, The Safety Rule). Also builds the environment the test server
// starts with, from nothing but these settings. Errors name a setting, never its value; nothing here logs.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** apps/web, wherever the tests are started from. */
export const WEB_DIR = path.resolve(__dirname, "../..");

export const TEST_REF = "ammzthqpycofwvxtpyhx";
export const TEST_URL = `https://${TEST_REF}.supabase.co`;
export const TEST_HOST = `${TEST_REF}.supabase.co`;
/** Projects a test must never reach: production Konva and Marketing. */
export const FORBIDDEN_REFS = { production: "bbfahndgnmdlehicmphe", marketing: "qpxojuhpujcmtezjswwd" } as const;

/** The agreed port for the test server (never 3000, the owner's dev server). */
export const TEST_PORT = 3100;
export const APP_ORIGIN = `http://localhost:${TEST_PORT}`;
/** The test build's own folder, so it never touches the dev server's .next. */
export const DIST_DIR = ".next-e2e";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "KEY_WRAPPING_KEY",
  "TEST_USER_EMAIL", "TEST_USER_PASSWORD",
] as const;

/** The settings the tests read. Only these leave this module. */
export type TestEnv = Record<(typeof REQUIRED)[number], string> & { NEXT_PUBLIC_ENCRYPT_CONTENT: string; NEXT_PUBLIC_ENCRYPT_ADDRESSES: string };

/** KEY=value lines of an env file; comments and blank lines skipped, one pair of surrounding quotes removed. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

const refused = (why: string) => Object.assign(new Error(`Browser tests refused to run: ${why}`), { code: "e2e_refused" });

/** The forbidden project a value mentions, if any. */
export function forbiddenRefIn(value: string): string | null {
  for (const [name, ref] of Object.entries(FORBIDDEN_REFS)) if (value.includes(ref)) return name;
  return null;
}

/** Throws unless this URL is exactly the Konva Test project. Every database client in the tests goes through it. */
export function assertTestUrl(url: string | undefined): string {
  if (url !== TEST_URL) throw refused(`a database address is not Konva Test (${TEST_REF}).`);
  return url;
}

/**
 * Checks a set of settings and returns them typed: both Supabase addresses are exactly Konva Test, nothing mentions the
 * production or Marketing project, and the test user is a made-up example.com address. `production` is the list of
 * production secrets (productionValues): a test setting equal to one of them is refused too.
 */
export function checkTestEnv(env: Record<string, string | undefined>, production: string[] = []): TestEnv {
  for (const key of REQUIRED) if (!env[key]) throw refused(`${key} is not set in apps/web/.env.test.local.`);
  assertTestUrl(env.SUPABASE_URL);
  assertTestUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  for (const [key, value] of Object.entries(env)) {
    const ref = value ? forbiddenRefIn(value) : null;
    if (ref) throw refused(`${key} mentions the ${ref} project.`);
    if (value && production.includes(value)) throw refused(`${key} has the same value as a production setting.`);
  }
  if (!/@example\.(com|org|net)$/i.test(env.TEST_USER_EMAIL ?? "")) throw refused("TEST_USER_EMAIL is not a made-up example.com address.");
  return { ...(env as TestEnv), NEXT_PUBLIC_ENCRYPT_CONTENT: env.NEXT_PUBLIC_ENCRYPT_CONTENT ?? "true", NEXT_PUBLIC_ENCRYPT_ADDRESSES: env.NEXT_PUBLIC_ENCRYPT_ADDRESSES ?? "true" };
}

// Values shorter than this (flags, "true", a tenant name like "common") are too common to call a leak.
const SECRET_MIN_LENGTH = 12;

/**
 * The values of the production settings files (apps/web/.env.local, apps/worker/.env, apps/ai/.env), for leak checks
 * only: a test setting, the test server's environment or the test build must hold none of them. Never printed.
 */
export function productionValues(): string[] {
  const files = ["apps/web/.env.local", "apps/worker/.env", "apps/ai/.env"].map((f) => path.join(WEB_DIR, "../..", f));
  const values = new Set<string>();
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const value of Object.values(parseEnvFile(readFileSync(file, "utf8")))) {
      if (value.length >= SECRET_MIN_LENGTH && !/^(true|false|https?:\/\/localhost[:/\d]*)$/i.test(value)) values.add(value);
    }
  }
  return [...values];
}

let cached: TestEnv | null = null;

/** The checked test settings. Also refuses when this process's own environment mentions a forbidden project. */
export function loadTestEnv(): TestEnv {
  if (cached) return cached;
  const file = path.join(WEB_DIR, ".env.test.local");
  if (!existsSync(file)) throw refused("apps/web/.env.test.local is missing (docs/TESTING.md, Konva Test Setup).");
  for (const [key, value] of Object.entries(process.env)) {
    const ref = value ? forbiddenRefIn(value) : null;
    if (ref) throw refused(`the shell's ${key} mentions the ${ref} project.`);
  }
  cached = checkTestEnv(parseEnvFile(readFileSync(file, "utf8")), productionValues());
  return cached;
}

/**
 * Settings the test server must never hold: provider secrets, the production key service and the old static key. The
 * server's environment is built from nothing (serverEnv), so none can be there; envProof checks it.
 */
export const FORBIDDEN_SERVER_KEY = /^(KMS_KEY_NAME|ENCRYPTION_KEY|GOOGLE_.*|MICROSOFT_.*|ZOOM_.*|INSTAGRAM_.*|META_.*|GRAPH_.*|GCP_.*|.*VAPID.*|NEXT_PUBLIC_(GOOGLE|MICROSOFT|INSTAGRAM)_.*)$/;

/** An environment for a child process: Next's types make NODE_ENV a required, known value. */
export type ServerEnv = NodeJS.ProcessEnv & Record<string, string>;

/**
 * The whole environment of the test build and server: the system basics and the test settings, nothing inherited.
 * NODE_ENV=test makes Next skip .env.local, and __NEXT_PROCESSED_ENV makes it load no env file at all, so the
 * production settings in apps/web/.env.local can never reach it by either road. The test user's sign-in stays out.
 */
export function serverEnv(env: TestEnv): ServerEnv {
  const basics: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "USER", "SHELL"]) if (process.env[key]) basics[key] = process.env[key]!;
  return {
    ...basics,
    NODE_ENV: "test",
    __NEXT_PROCESSED_ENV: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_DIST_DIR: DIST_DIR,
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    KEY_WRAPPING_KEY: env.KEY_WRAPPING_KEY,
    NEXT_PUBLIC_ENCRYPT_CONTENT: env.NEXT_PUBLIC_ENCRYPT_CONTENT,
    NEXT_PUBLIC_ENCRYPT_ADDRESSES: env.NEXT_PUBLIC_ENCRYPT_ADDRESSES,
    // The app checks a request's Origin against this (lib/server/request.ts): the test server's own address.
    APP_URL: APP_ORIGIN,
  };
}
