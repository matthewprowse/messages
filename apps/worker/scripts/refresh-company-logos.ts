// One-off, after company logos started being framed (src/photos/logo-image.ts): for every company,
//  1. a name still the default made from its domain ("Linkedin") takes the spelling its own senders use
//     ("LinkedIn"); a name you changed is left alone;
//  2. its automated senders saved as "Noreply", "No Reply" and the like are named for the company;
//  3. its logo is fetched and framed again, and a blurred one with nothing sharp to replace it is dropped.
//
//   npx tsx --env-file=.env scripts/refresh-company-logos.ts --dry-run
//   npx tsx --env-file=.env scripts/refresh-company-logos.ts [--names-only | --logos-only]
//
// Prints counts and company names only, never addresses or people's names.

import { companyNameFor, companyNameForDomain, isPlaceholderName } from "@messages/email-text/company";
import { allRows, db, must } from "../src/db";
import { saveIcon } from "../src/photos/company-icons";
import { openAddressRows } from "../src/vault";

const dryRun = process.argv.includes("--dry-run");
const doNames = !process.argv.includes("--logos-only");
const doLogos = !process.argv.includes("--names-only");
const AT_ONCE = 4;

const orgs = await openAddressRows(
  await allRows((from, to) => db.from("organizations").select("id, user_id, name, domain").order("id").range(from, to), "load companies"),
);
const contacts = await openAddressRows(
  await allRows(
    (from, to) => db.from("contacts").select("id, user_id, display_name, organization_id, contact_identities(kind, value)").not("organization_id", "is", null).order("id").range(from, to),
    "load company contacts",
  ),
);
const byOrg = new Map<string, typeof contacts>();
for (const c of contacts) byOrg.set(c.organization_id!, [...(byOrg.get(c.organization_id!) ?? []), c]);

if (doNames) {
  let renamedCompanies = 0;
  let renamedSenders = 0;
  for (const org of orgs) {
    const people = byOrg.get(org.id) ?? [];
    let name = org.name;
    if (org.domain && org.name === companyNameForDomain(org.domain)) {
      // The spelling most of its senders use, when they use the company's name at all.
      const counts = new Map<string, number>();
      for (const c of people) {
        const spelled = companyNameFor(org.domain, c.display_name);
        if (spelled !== org.name) counts.set(spelled, (counts.get(spelled) ?? 0) + 1);
      }
      const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (best) {
        console.log(`company: ${org.name} -> ${best}`);
        if (!dryRun) must(await db.from("organizations").update({ name: best }).eq("id", org.id), "rename company");
        name = best;
        renamedCompanies++;
      }
    }
    for (const c of people) {
      const emails = c.contact_identities.filter((i) => i.kind === "email").map((i) => i.value);
      if (emails.length === 0 || !emails.every((e) => isPlaceholderName(c.display_name, e))) continue;
      if (c.display_name === name) continue;
      console.log(`sender at ${name}: placeholder name -> ${name}`);
      if (!dryRun) must(await db.from("contacts").update({ display_name: name }).eq("id", c.id), "rename sender");
      renamedSenders++;
    }
  }
  console.log(`${dryRun ? "would rename" : "renamed"} ${renamedCompanies} companies and ${renamedSenders} senders`);
}

if (doLogos && !dryRun) {
  let next = 0;
  let saved = 0;
  const missing: string[] = [];
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      while (next < orgs.length) {
        const org = orgs[next++];
        if (!org.domain) continue;
        try {
          if (await saveIcon({ id: org.id, user_id: org.user_id, domain: org.domain }, true)) saved++;
          else missing.push(org.domain);
        } catch (err) {
          console.log(`logo failed for ${org.domain}: ${(err as { code?: string }).code ?? "error"}`);
        }
      }
    }),
  );
  console.log(`logos: ${saved} of ${orgs.length} saved; none sharp enough for: ${missing.sort().join(", ")}`);
}
