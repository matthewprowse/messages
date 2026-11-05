// The test server Playwright starts (playwright.config.ts, webServer): checks the settings, proves Next will see no
// production setting, builds the app into its own folder (.next-e2e) with only the test settings, scans the build for
// any production reference or secret, then runs `next start` on port 3100 until Playwright stops it. Any failed check
// stops it before a server exists. Run with tsx from apps/web. Prints setting names and file paths only.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { proveServerEnv, scanBuild } from "./server-proof";
import { DIST_DIR, loadTestEnv, serverEnv, TEST_PORT, WEB_DIR, type ServerEnv } from "./test-env";

const next = path.join(WEB_DIR, "node_modules/.bin/next");

function stop(why: string, findings: string[] = []): never {
  console.error(`[e2e server] ${why}`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}

// `next build` rewrites next-env.d.ts to point at the build folder's types; the file is the dev server's, so it is put
// back exactly as it was when the build ends, and also if the run is stopped part way.
async function buildKeepingNextEnv(env: ServerEnv): Promise<number> {
  const file = path.join(WEB_DIR, "next-env.d.ts");
  const before = readFileSync(file, "utf8");
  const restore = () => { if (readFileSync(file, "utf8") !== before) writeFileSync(file, before); };
  const build = spawn(next, ["build"], { cwd: WEB_DIR, env, stdio: "inherit" });
  const onSignal = (signal: NodeJS.Signals) => { build.kill(signal); restore(); process.exit(1); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await new Promise<number>((done) => build.on("exit", (code) => done(code ?? 1)));
  } finally {
    restore();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

async function main() {
  const env = loadTestEnv();
  const leaks = proveServerEnv(env);
  if (leaks.length) stop("Next would see production settings; refusing to build.", leaks);
  const server = serverEnv(env);

  // E2E_REUSE_BUILD=1 skips the build when the last one is still there, for writing tests against an app that did not change.
  // The scan below still runs on whatever is in the folder, so a reused build is checked just the same.
  if (process.env.E2E_REUSE_BUILD === "1" && existsSync(path.join(WEB_DIR, DIST_DIR, "BUILD_ID"))) {
    console.log(`[e2e server] Reusing the build in ${DIST_DIR}.`);
  } else {
    console.log(`[e2e server] Building into ${DIST_DIR} with the Konva Test settings only.`);
    if ((await buildKeepingNextEnv(server)) !== 0) stop("The test build failed.");
  }
  const found = scanBuild();
  if (found.length) stop("The test build holds a production reference or secret; refusing to start.", found);

  console.log(`[e2e server] Build is clean. Starting on port ${TEST_PORT}.`);
  const child = spawn(next, ["start", "-p", String(TEST_PORT), "-H", "localhost"], { cwd: WEB_DIR, env: server, stdio: "inherit" });
  // Playwright stops the server with a signal: pass it on to the one process started here, by its own PID.
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 0));
}

void main();
