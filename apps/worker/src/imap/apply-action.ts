// Applies a read, unread, archive, unarchive, delete, undelete, junk or not junk made in the app to the messages on the
// IMAP server. Delete moves mail to Trash, never deletes it for good. I/O for connectors/imap.ts, which serialises it
// on its command queue and settles the action row.

import type { ImapFlow } from "imapflow";
import type { Tables } from "@messages/db";
import { db, must } from "../db";
import { imapMove, type FolderPaths } from "../ingest/imap-place";
import { undoesNotJunk } from "../ingest/junk-undo";
import { mapLimit, push } from "../util";

const WRITE_AT_ONCE = 6; // row updates in flight together

export async function applyMessageAction(client: ImapFlow, accountId: string, row: Tables<"mail_actions">, paths: FolderPaths) {
  const messages = must(
    await db
      .from("messages")
      .select("id, direction, provider_meta")
      .eq("thread_id", row.thread_id)
      .eq("account_id", accountId),
    "load action messages",
  );
  const located = messages
    .map((m) => ({ id: m.id, direction: m.direction, meta: m.provider_meta as { folder?: string; uid?: number; uid_validity?: number; from?: string } }))
    .filter((m) => m.meta.folder && m.meta.uid);

  const pick = (want: (m: (typeof located)[number]) => boolean) => {
    const byFolder = new Map<string, typeof located>();
    for (const m of located.filter(want)) push(byFolder, m.meta.folder!, m);
    return byFolder;
  };

  if (row.action === "read" || row.action === "unread") {
    for (const [folder, list] of pick((m) => m.direction === "inbound")) {
      const lock = await client.getMailboxLock(folder);
      try {
        const uids = list.map((m) => m.meta.uid!);
        if (row.action === "read") await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
        // Unread marks only the latest message, as in Mail.
        else await client.messageFlagsRemove([Math.max(...uids)], ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
      if (row.action === "unread") break;
    }
    return;
  }

  const move = imapMove(row.action, paths);
  if (!move) throw Object.assign(new Error("unknown action"), { code: "UNKNOWN_ACTION" });
  if ("missing" in move) throw Object.assign(new Error("missing folder"), { code: `NO_${move.missing.toUpperCase()}` });
  // Undoing Not Junk only puts back mail that Not Junk took out of Junk; junk the AI sorted out stays put.
  const undo = await undoesNotJunk(db, row);
  const wanted = (m: (typeof located)[number]) =>
    move.from.includes(m.meta.folder!) && (!undo || (!!paths.junk && m.meta.from === paths.junk));
  for (const [folder, list] of pick(wanted)) {
    // Undoing a delete can send messages from one folder to different places.
    const byDestination = new Map<string, typeof list>();
    for (const m of list) push(byDestination, move.to(m.meta.from), m);
    for (const [to, group] of byDestination) {
      if (to === folder) continue;
      const lock = await client.getMailboxLock(folder);
      try {
        const moved = await client.messageMove(group.map((m) => m.meta.uid!), to, { uid: true });
        if (!moved) continue;
        await mapLimit(group, WRITE_AT_ONCE, async (m) => {
          const newUid = moved.uidMap?.get(m.meta.uid!);
          const meta = newUid
            ? { folder: to, uid: newUid, uid_validity: Number(moved.uidValidity ?? 0), ...(move.remember ? { from: folder } : {}) }
            : { left: folder }; // the server did not say where it went: the next sync finds it
          must(await db.from("messages").update({ provider_meta: meta }).eq("id", m.id), "save moved message");
        });
      } finally {
        lock.release();
      }
    }
  }
}
