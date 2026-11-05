// Proof that the test server can never see production settings: what Next's own env loader gives a process started
// with the test server's environment, and a scan of the test build for any production reference or secret. Used by
// serve.ts before and after the build, and by safety.spec.ts. Reports setting names and file paths, never values.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DIST_DIR, FORBIDDEN_REFS, FORBIDDEN_SERVER_KEY, productionValues, serverEnv, WEB_DIR, type ServerEnv, type TestEnv } from "./test-env";

/** What went wrong, as setting names or file paths only. Empty when the proof holds. */
export type Findings = string[];

// Runs Next's env loader (@next/env, the one `next build` and `next start` call) in a child process with exactly the
// given environment, and hands back the environment it ends up with. Through a pipe, never printed.
function loadedEnv(env: ServerEnv): Record<string, string> {
  const nextEnv = createRequire(require.resolve("next/package.json", { paths: [WEB_DIR] })).resolve("@next/env");
  const script = `const { loadEnvConfig } = require(${JSON.stringify(nextEnv)}); loadEnvConfig(${JSON.stringify(WEB_DIR)}, false, { info() {}, error() {} }); process.stdout.write(JSON.stringify(process.env));`;
  return JSON.parse(execFileSync(process.execPath, ["-e", script], { cwd: WEB_DIR, env, encoding: "utf8" })) as Record<string, string>;
}

/** Problems with one loaded environment: a forbidden setting, a forbidden project, or a production secret. */
function check(label: string, env: Record<string, string>, secrets: string[]): Findings {
  const out: Findings = [];
  for (const [key, value] of Object.entries(env)) {
    if (FORBIDDEN_SERVER_KEY.test(key)) out.push(`${label}: ${key} is set`);
    for (const [name, ref] of Object.entries(FORBIDDEN_REFS)) if (value.includes(ref)) out.push(`${label}: ${key} mentions the ${name} project`);
    if (secrets.includes(value)) out.push(`${label}: ${key} holds a production value`);
  }
  return out;
}

/**
 * Whether Next, started with the test server's environment in apps/web (next to .env.local), ends up with any
 * production setting. Checked twice: as the server really starts (no env file loaded at all, so not even the test
 * user's sign-in), and with the __NEXT_PROCESSED_ENV guard taken away, to prove NODE_ENV=test alone already keeps
 * .env.local out. A control run, started the way a production server is, must find .env.local, or the check proves nothing.
 */
export function proveServerEnv(env: TestEnv): Findings {
  const secrets = productionValues();
  const real = serverEnv(env);
  const loaded = loadedEnv(real);
  const out = check("test server", loaded, secrets);
  for (const key of Object.keys(loaded)) if (key.startsWith("TEST_USER_")) out.push(`test server: ${key} is set`);
  const unguarded = { ...real };
  delete unguarded.__NEXT_PROCESSED_ENV;
  out.push(...check("without the env file guard", loadedEnv(unguarded), secrets));
  if (existsSync(path.join(WEB_DIR, ".env.local")) && check("control", loadedEnv({ ...unguarded, NODE_ENV: "production" }), secrets).length === 0) {
    out.push("control: a production start did not see .env.local either, so this check cannot tell");
  }
  return out;
}

// Bytes per read when scanning: big enough to be quick, and an overlap so a value split across two reads is still found.
const CHUNK_BYTES = 4 * 1024 * 1024;

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Every file of the test build (DIST_DIR) that mentions the production or Marketing project, or holds a value from the
 * production settings files. Throws when there is no build to scan, so a missing build never passes.
 */
export function scanBuild(): Findings {
  return filesMentioning([...Object.values(FORBIDDEN_REFS), ...productionValues()]);
}

/** Every file of the test build holding any of these values, as paths relative to apps/web. Throws when there is no build. */
export function filesMentioning(needles: string[], dist: string = path.join(WEB_DIR, DIST_DIR)): Findings {
  if (!existsSync(dist)) throw Object.assign(new Error(`No test build at ${DIST_DIR} to scan.`), { code: "no_build" });
  const longest = Math.max(...needles.map((n) => n.length));
  const out: Findings = [];
  for (const file of files(dist)) {
    const size = statSync(file).size;
    const text = size <= CHUNK_BYTES ? readFileSync(file, "latin1") : null;
    const hit = text !== null ? needles.some((n) => text.includes(n)) : scanLarge(file, needles, longest);
    if (hit) out.push(path.relative(WEB_DIR, file));
  }
  return out;
}

// Large files (the webpack cache) are read in overlapping pieces rather than whole.
function scanLarge(file: string, needles: string[], longest: number): boolean {
  const buf = readFileSync(file);
  for (let at = 0; at < buf.length; at += CHUNK_BYTES) {
    const piece = buf.toString("latin1", at, Math.min(buf.length, at + CHUNK_BYTES + longest));
    if (needles.some((n) => piece.includes(n))) return true;
  }
  return false;
}
