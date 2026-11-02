// Catch-up for files that are not in storage yet: mail synced before files were saved, or an upload that failed. Each
// message is fetched again from the folder and UID it was stored from. I/O for connectors/imap.ts; grouping is ./missing-group.ts.

import type { ImapFlow } from "imapflow";
import { log } from "../log";
import { saveFilesQuietly } from "../ingest/attachment-files";
import { parseEmail } from "../ingest/normalize-email";
import { groupByFolder, type MissingMessage } from "./missing-group";

/** Fetches each message again and saves its files. */
export async function saveMissingFiles(client: ImapFlow, accountId: string, userId: string, todo: MissingMessage[]) {
  if (todo.length === 0) return;
  let saved = 0;
  for (const [folder, entry] of groupByFolder(todo)) {
    const lock = await client.getMailboxLock(folder);
    try {
      // A renumbered folder means these UIDs point at other messages now.
      if (Number(client.mailbox && client.mailbox.uidValidity) !== entry.uidValidity) continue;
      for await (const msg of client.fetch([...entry.messages.keys()], { uid: true, source: true }, { uid: true })) {
        const messageId = entry.messages.get(msg.uid);
        if (!messageId || !msg.source) continue;
        const mail = await parseEmail(msg.source, `${folder}:${entry.uidValidity}:${msg.uid}`);
        saved += await saveFilesQuietly(accountId, userId, messageId, mail.attachments);
      }
    } finally {
      lock.release();
    }
  }
  if (saved > 0) log.info("attachment files saved", { account: accountId, saved });
}
