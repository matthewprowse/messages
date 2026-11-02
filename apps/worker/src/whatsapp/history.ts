// Imports one WhatsApp history batch (what the phone sends when the device links): names and ids first, then the
// messages oldest first, stored a chunk per database call. The connector (connectors/whatsapp.ts) supplies the
// pieces that need its link state through HistoryDeps.

import type { BaileysEventMap, Chat, Contact, WAMessage } from "baileys";
import { jidNormalizedUser } from "baileys";
import { setAccountStatus } from "../db";
import { errorCode, log } from "../log";
import { HISTORY_PER_CALL } from "./ingest";
import { unreadInHistory } from "./normalize";
import type { Prepared } from "./person";
import { storeHistoryChunk } from "./history-chunk";

export interface HistoryDeps {
  accountId: string;
  onLidMapping(pairs: { lid: string; pn: string }[]): Promise<void>;
  onContacts(contacts: Partial<Contact>[]): Promise<void>;
  rememberChats(chats: Chat[]): void;
  prepare(msg: WAMessage, opts: { live: boolean; unread: boolean }): Promise<Prepared | { react: () => Promise<void> } | null>;
}

/** `n` is this link's batch number, for the log line. */
export async function importHistory(deps: HistoryDeps, batch: BaileysEventMap["messaging-history.set"], n: number) {
  const id = deps.accountId;
  await setAccountStatus(id, "syncing", "Importing the history from your phone.").catch(() => undefined);
  if (batch.lidPnMappings?.length) await deps.onLidMapping(batch.lidPnMappings);
  if (batch.contacts.length) await deps.onContacts(batch.contacts);
  deps.rememberChats(batch.chats);

  const unreadByChat = new Map(batch.chats.filter((c) => c.id).map((c) => [jidNormalizedUser(c.id!), c.unreadCount ?? 0]));
  const sorted = [...batch.messages].sort((a, b) => Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0));
  const unread = unreadInHistory(
    sorted.map((m) => ({ id: m.key.id ?? "", chat: jidNormalizedUser(m.key.remoteJid ?? ""), fromMe: !!m.key.fromMe, at: Number(m.messageTimestamp ?? 0) })),
    unreadByChat,
  );

  // Stored a chunk per database call, in order. A chunk or message that still fails after retries is logged and skipped.
  let inserted = 0;
  let pending: Prepared[] = [];
  const flush = async () => {
    const chunk = pending;
    pending = [];
    if (chunk.length === 0) return;
    inserted += await storeHistoryChunk(id, chunk);
  };
  for (const msg of sorted) {
    try {
      const item = await deps.prepare(msg, { live: false, unread: unread.has(msg.key.id ?? "") });
      if (!item) continue;
      if ("react" in item) {
        // A reaction is saved on the message it reacts to, so the messages before it are stored first.
        await flush();
        await item.react();
        continue;
      }
      pending.push(item);
      if (pending.length >= HISTORY_PER_CALL) await flush();
    } catch (err) {
      log.warn("whatsapp history message failed", { account: id, code: errorCode(err) });
    }
  }
  await flush();
  log.info("whatsapp history batch", {
    account: id,
    batch: n,
    chats: batch.chats.length,
    messages: batch.messages.length,
    inserted,
    progress: batch.progress ?? null,
  });
  await setAccountStatus(id, "connected").catch(() => undefined);
}
