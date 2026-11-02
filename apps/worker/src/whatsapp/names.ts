// Names and ids WhatsApp tells us about: saved contact names, group subjects, privacy ID (LID) to phone mappings and chats
// read on your phone. Each writes through a database function that decides what wins; the in-memory maps stay the
// connector's, passed in here.

import { isLidUser, isPnUser, jidNormalizedUser, type Chat, type Contact } from "baileys";
import { addressIndex, chatIndex } from "@messages/crypto/addresses";
import { db, must } from "../db";
import { log } from "../log";
import { chunks, mapLimit } from "../util";
import { keysFor, sealAddress } from "../vault";
import type { BoundedMap } from "./bounded-map";
import { e164 } from "./normalize";
import { personJson, type AccountCtx } from "./person";

/** Remembers contact names in the maps (a saved name wins over a pushed one) and stores them on the account's people. */
export async function saveContactNames(ctx: AccountCtx, contacts: Partial<Contact>[], names: { saved: BoundedMap<string, string>; push: BoundedMap<string, string> }) {
  const people: Awaited<ReturnType<typeof personJson>>[] = [];
  const keys = await keysFor(ctx.userId);
  for (const c of contacts) {
    if (!c.id) continue;
    const jids = [c.id, c.lid, c.phoneNumber].filter((j): j is string => !!j).map((j) => jidNormalizedUser(j));
    for (const j of jids) {
      if (c.name) names.saved.set(j, c.name);
      if (c.notify) names.push.set(j, c.notify);
    }
    // A saved name wins. A name the person set for themselves only replaces a bare number (decided in SQL).
    const name = c.name ?? c.verifiedName ?? c.notify ?? null;
    if (!name) continue;
    people.push(
      await personJson(keys, {
        phone: e164(jids.find((j) => isPnUser(j))),
        lid: jids.find((j) => isLidUser(j)) ?? null,
        display_name: name,
        push_name: c.notify ?? null,
      }, ctx.userId),
    );
  }
  if (people.length === 0) {
    log.info("whatsapp names received", { account: ctx.accountId, contacts: contacts.length, names: 0, known: 0 });
    return;
  }
  let known = 0;
  for (const batch of chunks(people, 200)) {
    known += must(await db.rpc("whatsapp_contact_names", { p_account_id: ctx.accountId, p_people: batch }), "save whatsapp names");
  }
  log.info("whatsapp names received", { account: ctx.accountId, contacts: contacts.length, names: people.length, known });
}

/** Stores group names that changed. One read, then only the writes needed. `named` is group JID to subject. */
export async function saveGroupNames(ctx: AccountCtx, named: Map<string, string>) {
  if (named.size === 0) return;

  // Conversations are found by their chat's index: the database matches on that, not the JID.
  const keys = await keysFor(ctx.userId);
  const indexes = new Map(await Promise.all([...named.keys()].map(async (id) => [id, await chatIndex(keys, id)] as const)));
  const stored = new Map<string, string | null>();
  for (const batch of chunks([...indexes.values()], 100)) {
    const rows = must(
      await db.from("threads").select("provider_thread_index, group_name").eq("account_id", ctx.accountId).in("provider_thread_index", batch),
      "load group names",
    );
    for (const r of rows) if (r.provider_thread_index) stored.set(r.provider_thread_index, r.group_name);
  }
  let renamed = 0;
  for (const [id, subject] of named) {
    const index = indexes.get(id)!;
    if (!stored.has(index) || stored.get(index) === subject) continue; // no conversation yet, or unchanged
    must(await db.from("threads").update({ group_name: subject }).eq("account_id", ctx.accountId).eq("provider_thread_index", index), "save group name");
    renamed++;
  }
  if (renamed > 0) log.info("whatsapp group names saved", { account: ctx.accountId, renamed });
}

export async function saveLidMappings(ctx: AccountCtx, pairs: { lid: string; pn: string }[], maps: { pnByLid: BoundedMap<string, string | null>; mappedLids: BoundedMap<string, string> }) {
  // A history batch can carry thousands of pairs, so a few are saved at a time.
  await mapLimit(pairs, 4, async (pair) => {
    const phone = e164(pair.pn);
    if (!phone) return;
    const lid = jidNormalizedUser(pair.lid);
    const pn = jidNormalizedUser(pair.pn);
    maps.pnByLid.set(lid, pn);
    if (maps.mappedLids.get(lid) === pn) return;
    const keys = await keysFor(ctx.userId);
    must(
      await db.rpc("whatsapp_map_lid", {
        p_account_id: ctx.accountId,
        p_lid_jid: await sealAddress(ctx.userId, lid),
        p_pn_jid: await sealAddress(ctx.userId, pn),
        p_phone: await sealAddress(ctx.userId, phone),
        p_lid_index: await addressIndex(keys, lid),
        p_phone_index: await addressIndex(keys, phone),
        p_lid_chat_index: await chatIndex(keys, lid),
        p_pn_chat_index: await chatIndex(keys, pn),
      }),
      "map privacy id",
    );
    maps.mappedLids.set(lid, pn);
  });
}

/** Chats read on your phone are marked read here too. No receipt is sent: the phone already did. */
export async function markChatsRead(ctx: AccountCtx, updates: Partial<Chat>[]) {
  const read = updates.filter((u) => u.id && u.unreadCount === 0).map((u) => jidNormalizedUser(u.id!));
  if (read.length === 0) return;
  const keys = await keysFor(ctx.userId);
  const indexes = await Promise.all(read.map((jid) => chatIndex(keys, jid)));
  const changed = must(await db.rpc("whatsapp_mark_read", { p_account_id: ctx.accountId, p_chat_jids: read, p_chat_indexes: indexes }), "mark chats read");
  if (changed > 0) log.info("whatsapp chats read on phone", { account: ctx.accountId, threads: changed });
}
