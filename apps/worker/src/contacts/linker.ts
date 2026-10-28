// Every 15 minutes, and once at startup, finds contacts that are one person. Certain ones are merged
// (merge_contacts with p_automatic, one at a time, each pair checked again just before), likely ones are
// saved as suggestions for a one-click merge. See match.ts for the rules.
//
// CONTACT_AUTOMERGE=0 turns automatic merging off: certain pairs are then suggested instead.

import type { Json } from "@messages/db";
import { startEvery } from "../backoff";
import { allRows, db, must } from "../db";
import { errorCode, log } from "../log";
import { chunks, push } from "../util";
import { countryCodeFrom } from "./cards-store";
import { chooseKeep, findMatches, mergeReason, ordered, pairKey, type MatchInput, type Suggestion } from "./match";
import { ownIdentities } from "./own";
import { signaturePhones } from "./signature-phones";
import { FIELD } from "@messages/crypto/fields";
import { open, openAddresses } from "../vault";

const FIRST_RUN_MS = 45_000;
const EVERY_MS = 15 * 60_000;
const SIGNATURE_DAYS = 180;
const SIGNATURE_LIMIT = 3000; // newest inbound emails scanned per run
const BODIES_AT_ONCE = 4; // signature body reads in flight at once, 100 messages each
const MAX_MERGES_PER_RUN = 100; // a safety stop: the rest wait for the next run
const DEFAULT_AUTOMERGE = true;

export function autoMergeEnabled(): boolean {
  const v = (process.env.CONTACT_AUTOMERGE ?? "").trim().toLowerCase();
  if (!v) return DEFAULT_AUTOMERGE;
  return !["0", "false", "off", "no"].includes(v);
}

/** Numbers found per message, by "<country code>:<message id>". Bodies do not change, so this is kept. */
const signatureCache = new Map<string, string[]>();

let started = false;

export function startContactLinker() {
  if (started) return;
  started = true;
  startEvery(FIRST_RUN_MS, EVERY_MS, runContactLinker, (err) => log.warn("contact linker failed", { code: errorCode(err) }));
}

async function runContactLinker() {
  const users = [...new Set(must(await db.from("accounts").select("user_id"), "load linker users").map((a) => a.user_id))];
  for (const user of users) {
    try {
      await linkUser(user);
    } catch (err) {
      log.warn("contact linker user failed", { user, code: errorCode(err) });
    }
  }
}

/** Everything the matcher needs for one user, every page of it. */
async function loadLinkerData(user: string) {
  const since = new Date(Date.now() - SIGNATURE_DAYS * 24 * 60 * 60_000).toISOString();
  const [accounts, own, contacts, identities, cards, decided, groupThreads] = await Promise.all([
    db.from("accounts").select("id, provider, address, pairing_phone").eq("user_id", user).then((r) => openAddresses(user, must(r, "load accounts"))),
    ownIdentities(user),
    allRows((f, t) => db.from("contacts").select("id, display_name, organization_id, created_at").eq("user_id", user).order("id").range(f, t), "load contacts"),
    allRows((f, t) => db.from("contact_identities").select("id, contact_id, kind, value").eq("user_id", user).order("id").range(f, t), "load identities").then((r) => openAddresses(user, r)),
    allRows((f, t) => db.from("address_book_cards").select("id, name, emails, phones").eq("user_id", user).order("id").range(f, t), "load cards").then(async (r) => {
      await openAddresses(user, r);
      // A card's name is encrypted; a card saved before that has it plain.
      return Promise.all(r.map(async (c) => ({ ...c, name: await open(user, FIELD.cardName, c.name) })));
    }),
    allRows(
      (f, t) => db.from("contact_suggestions").select("id, contact_a, contact_b, status").eq("user_id", user).neq("status", "merged").order("id").range(f, t),
      "load suggestions",
    ),
    // Group chats: everyone in one is a different person from everyone else in it.
    allRows((f, t) => db.from("threads").select("id").eq("user_id", user).eq("is_group", true).order("id").range(f, t), "load groups"),
  ]);
  const cc = countryCodeFrom(accounts);
  const mailAccounts = accounts.filter((a) => a.provider === "icloud" || a.provider === "gmail" || a.provider === "imap").map((a) => a.id);

  const groupMembers = new Map<string, string[]>();
  for (const ids of chunks(groupThreads.map((g) => g.id), 100)) {
    const rows = await allRows(
      (f, t) => db.from("thread_participants").select("thread_id, contact_id").in("thread_id", ids).order("thread_id").order("contact_id").range(f, t),
      "load group members",
    );
    for (const r of rows) push(groupMembers, r.thread_id, r.contact_id);
  }

  // Signatures of recent inbound personal email (not newsletters), newest first.
  const recent = mailAccounts.length
    ? await allRows(
        (f, t) =>
          db
            .from("messages")
            .select("id, sender_contact_id")
            .eq("user_id", user)
            .eq("direction", "inbound")
            .in("account_id", mailAccounts)
            .is("list_unsubscribe", null)
            .not("sender_contact_id", "is", null)
            .gte("sent_at", since)
            .order("sent_at", { ascending: false })
            .order("id")
            .range(f, t),
        "load signature messages",
        SIGNATURE_LIMIT,
      )
    : [];
  const uncached = recent.filter((m) => !signatureCache.has(`${cc}:${m.id}`)).map((m) => m.id);
  for (const group of chunks(chunks(uncached, 100), BODIES_AT_ONCE)) {
    await Promise.all(
      group.map(async (ids) => {
        const rows = must(await db.from("messages").select("id, body_text").in("id", ids), "load signature bodies");
        for (const r of rows) signatureCache.set(`${cc}:${r.id}`, signaturePhones(await open(user, FIELD.body, r.body_text), cc));
      }),
    );
  }
  const sigPhones: MatchInput["signaturePhones"] = [];
  for (const m of recent) {
    for (const phone of signatureCache.get(`${cc}:${m.id}`) ?? []) sigPhones.push({ contactId: m.sender_contact_id!, phone });
  }

  const input: MatchInput = {
    contacts: contacts.map((c) => ({ id: c.id, name: c.display_name, organizationId: c.organization_id })),
    identities: identities.map((i) => ({ id: i.id, contactId: i.contact_id, kind: i.kind, value: i.value })),
    cards,
    signaturePhones: sigPhones,
    own: [...own],
    dismissed: decided.filter((s) => s.status === "dismissed").map((s): [string, string] => [s.contact_a, s.contact_b]),
    groups: [...groupMembers.values()],
    countryCode: cc,
  };
  return { input, contacts, decided, recent };
}

async function linkUser(user: string) {
  const automerge = autoMergeEnabled();
  const { input, contacts, decided, recent } = await loadLinkerData(user);
  const result = findMatches(input);

  const contactInfo = new Map(contacts.map((c) => [c.id, { name: c.display_name, createdAt: c.created_at }]));
  // Message counts pick which contact a merge keeps. Only contacts in certain merges need one, counted at once.
  const counted = await Promise.all(
    [...new Set(result.certain.flatMap((c) => c.contacts))].map(async (id) => {
      const { count: n, error } = await db.from("messages").select("id", { count: "exact", head: true }).eq("sender_contact_id", id);
      if (error) throw Object.assign(new Error("count messages failed"), { code: error.code });
      return [id, n ?? 0] as const;
    }),
  );
  const counts = new Map<string, number>(counted);

  // Certain: merge into the contact with the most messages, one at a time.
  const keptAs = new Map<string, string>();
  const certainAsSuggestions: Suggestion[] = [];
  let merged = 0;
  let mergeFailed = 0;
  for (const cluster of result.certain) {
    const keep = chooseKeep(cluster.contacts, counts, contactInfo);
    for (const other of cluster.contacts) {
      if (other === keep) continue;
      const reason = mergeReason(cluster, other);
      if (!automerge) {
        const [contactA, contactB] = ordered(keep, other);
        certainAsSuggestions.push({ contactA, contactB, reason: "other", evidence: { certain: reason }, score: 0.95 });
        continue;
      }
      if (merged >= MAX_MERGES_PER_RUN) continue;
      const still = must(await db.from("contacts").select("id").eq("user_id", user).in("id", [keep, other]), "check merge pair");
      if (still.length !== 2) continue;
      const { error } = await db.rpc("merge_contacts", { p_keep: keep, p_merge: other, p_reason: reason, p_automatic: true, p_user: user });
      if (error) {
        mergeFailed++;
        log.warn("contact merge refused", { user, keep, merge: other, code: error.code });
        continue;
      }
      merged++;
      keptAs.set(other, keep);
    }
  }

  // Likely: follow the merges just made, then save new pairs and drop pairs no longer found.
  const rep = (id: string) => keptAs.get(id) ?? id;
  const kept = new Set(input.dismissed.map(([a, b]) => pairKey(rep(a), rep(b))));
  const wanted = new Map<string, Suggestion>();
  for (const s of [...certainAsSuggestions, ...result.suggestions]) {
    const a = rep(s.contactA);
    const b = rep(s.contactB);
    const k = pairKey(a, b);
    if (a === b || kept.has(k)) continue;
    if ((wanted.get(k)?.score ?? -1) >= s.score) continue;
    const [contactA, contactB] = ordered(a, b);
    wanted.set(k, { ...s, contactA, contactB });
  }

  // merge_contacts has already moved pending pairs of a merged contact onto the kept one.
  const known = new Set(decided.map((s) => pairKey(rep(s.contact_a), rep(s.contact_b))));
  const fresh = [...wanted.entries()].filter(([k]) => !known.has(k)).map(([, s]) => s);
  for (const batch of chunks(fresh, 200)) {
    must(
      await db.from("contact_suggestions").upsert(
        batch.map((s) => ({
          user_id: user,
          contact_a: s.contactA,
          contact_b: s.contactB,
          reason: s.reason,
          evidence: s.evidence as Json,
          score: s.score,
        })),
        { onConflict: "user_id,contact_a,contact_b", ignoreDuplicates: true },
      ),
      "save suggestions",
    );
  }

  const stale = decided.filter((s) => s.status === "pending" && !wanted.has(pairKey(rep(s.contact_a), rep(s.contact_b)))).map((s) => s.id);
  for (const ids of chunks(stale, 200)) {
    must(await db.from("contact_suggestions").delete().eq("user_id", user).eq("status", "pending").in("id", ids), "remove stale suggestions");
  }

  // Results for messages no longer scanned are not needed again.
  if (signatureCache.size > SIGNATURE_LIMIT * 4) {
    const seen = new Set(recent.map((m) => `${input.countryCode}:${m.id}`));
    for (const k of signatureCache.keys()) if (!seen.has(k)) signatureCache.delete(k);
  }

  log.info("contact linker", {
    user,
    contacts: contacts.length,
    certain: result.certain.reduce((n, c) => n + c.contacts.length - 1, 0),
    merged,
    merge_failed: mergeFailed,
    suggestions: wanted.size,
    added: fresh.length,
    removed: stale.length,
    automerge,
  });
}
