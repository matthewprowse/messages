import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sleep } from "../src/backoff";
import { db, must } from "../src/db";
import { linkOrganizationLogos, queueCompanies, queueDomains, workLogoQueue } from "../src/logos/job";

// Works the shared company logo queue to the end, for the first backfill and for test runs, without
// waiting on the running workers: the sync worker's steps here, and the Gemini steps by running the AI
// worker's `python3 -m ai logos` in between. Writes the company_logos table and the "logos" bucket, then
// points each company at its logo (organizations.logo_path), which is what the app shows.
//
//   npx tsx --env-file=.env scripts/company-logos.ts --from-orgs      every company in Konva
//   npx tsx --env-file=.env scripts/company-logos.ts --list <file>    "domain<TAB>name" lines
//   add --again to look again at companies already done
//
// Prints counts only, never addresses.

const args = process.argv.slice(2);
const listFile = args.includes("--list") ? args[args.indexOf("--list") + 1] : null;
const again = args.includes("--again");
const aiDir = fileURLToPath(new URL("../../ai", import.meta.url));

let domains: string[] = [];
if (listFile) {
  const rows = readFileSync(listFile, "utf8")
    .split("\n")
    .map((line) => line.trim().split("\t"))
    .filter(([domain, name]) => domain && name)
    .map(([domain, name]) => ({ domain: domain.toLowerCase(), name }));
  domains = rows.map((r) => r.domain);
  console.log(`queued ${await queueDomains(rows)} new of ${rows.length}`);
}
if (args.includes("--from-orgs")) console.log(`queued ${await queueCompanies()} new companies`);
if (!listFile && !args.includes("--from-orgs")) {
  console.log("Give --from-orgs or --list <file>.");
  process.exit(1);
}
if (again) {
  const filter = db.from("company_logos").update({ status: "queued", round: 1, pick: null, search_urls: [], updated_at: new Date().toISOString() }).eq("status", "done").eq("manual", false);
  const rows = must(await (domains.length ? filter.in("domain", domains) : filter).select("domain"), "queue again");
  console.log(`looking again at ${rows.length}`);
}

/** How many companies wait at each step. A dropped connection is tried again rather than ending the run. */
async function waiting(): Promise<Record<string, number>> {
  for (let attempt = 0; ; attempt++) {
    const { data } = await db.from("company_logos").select("domain, status").neq("status", "done");
    if (data) return data.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {} as Record<string, number>);
    if (attempt >= 5) throw new Error("could not read the logo queue");
    await sleep(5000 * (attempt + 1));
  }
}

let stalled = 0;
let last = "";
for (;;) {
  while ((await workLogoQueue().catch(() => 1)) > 0) {
    // until nothing is queued or judged
    const now = JSON.stringify(await waiting());
    stalled = now === last ? stalled + 1 : 0;
    last = now;
    if (stalled > 5) break; // steps that keep failing
  }
  const counts = await waiting();
  console.log(new Date().toISOString().slice(11, 19), counts);
  if ((counts.judging ?? 0) + (counts.searching ?? 0) > 0) {
    const ai = spawnSync("python3", ["-m", "ai", "logos"], { cwd: aiDir, stdio: "inherit" });
    if (ai.status !== 0) throw new Error("the AI worker's logo step failed");
    continue;
  }
  if (Object.keys(counts).length === 0 || stalled > 5) break;
}

const done = must(await db.from("company_logos").select("source, path"), "load results");
const bySource = done.reduce((acc, r) => ({ ...acc, [r.path ? (r.source ?? "?") : "letter"]: (acc[r.path ? (r.source ?? "?") : "letter"] ?? 0) + 1 }), {} as Record<string, number>);
console.log("logos by source", bySource);
console.log(`first letter: ${bySource.letter ?? 0} of ${done.length}`);
console.log(`companies pointed at a new logo: ${await linkOrganizationLogos()}`);
