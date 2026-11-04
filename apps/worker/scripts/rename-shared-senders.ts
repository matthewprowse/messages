// One-off, after "<person> via <Company>" and "<person> on <Company>" senders started being named for the
// company (senderName in packages/email-text). LinkedIn, Google Docs and the like send everyone's
// notifications from one address, so the first person it wrote about named the contact and every later
// notice was filed under that name. A contact named that way, whose company is its organization, is
// renamed to the organization's name. Anyone with a phone number or a WhatsApp chat is a person and is
// left alone.
//
//   npx tsx --env-file=.env scripts/rename-shared-senders.ts --dry-run
//   npx tsx --env-file=.env scripts/rename-shared-senders.ts
//
// Prints counts and company names only, never addresses or people's names.

import { viaCompany } from "@messages/email-text/company";
import { allRows, db, must } from "../src/db";
import { FIELD } from "@messages/crypto/fields";
import { open, openAddressRows, sealName } from "../src/vault";

const dryRun = process.argv.includes("--dry-run");

const squash = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Names are sealed (contacts' are opened with the addresses): opened here, and sealed again when written.
const orgs = await Promise.all(
  (await openAddressRows(
    await allRows((from, to) => db.from("organizations").select("id, user_id, name, domain").order("id").range(from, to), "load companies"),
  )).map(async (o) => ({ ...o, name: (await open(o.user_id, FIELD.name, o.name)) ?? "" })),
);
const orgById = new Map(orgs.map((o) => [o.id, o]));
const contacts = await openAddressRows(
  await allRows(
    (from, to) => db.from("contacts").select("id, user_id, display_name, organization_id, contact_identities(kind, value)").not("organization_id", "is", null).order("id").range(from, to),
    "load company contacts",
  ),
);

const perCompany = new Map<string, number>();
let renamed = 0;
for (const c of contacts) {
  const via = viaCompany(c.display_name);
  const org = orgById.get(c.organization_id!);
  if (!via || !org || !squash(org.name)) continue;
  // The same test the app uses to treat the sender as the company: the name ends in the organization's.
  if (!squash(via).startsWith(squash(org.name))) continue;
  if (c.contact_identities.some((i) => i.kind !== "email")) continue;
  perCompany.set(org.name, (perCompany.get(org.name) ?? 0) + 1);
  if (!dryRun) must(await db.from("contacts").update({ display_name: await sealName(c.user_id, org.name), display_name_rank: 0 }).eq("id", c.id), "rename shared sender");
  renamed++;
}
for (const [name, count] of [...perCompany].sort()) console.log(`${name}: ${count}`);
console.log(`${dryRun ? "would rename" : "renamed"} ${renamed} shared senders`);
