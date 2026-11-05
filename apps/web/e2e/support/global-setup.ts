// Runs once before the browser tests: refuses to go on unless every setting points at Konva Test, then seeds each project's
// test user with the made-up data (seed.ts). Prints counts only.

import { seedAll } from "./seed";
import { loadTestEnv } from "./test-env";

export default async function globalSetup() {
  loadTestEnv();
  const started = Date.now();
  const made = await seedAll();
  const each = made.map((m) => `${m.project}: ${m.threads} conversations, ${m.messages} messages, ${m.contacts} contacts`).join("; ");
  console.log(`[e2e seed] ${each} in ${Date.now() - started} ms.`);
}
