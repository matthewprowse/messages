import { ImapFlow } from "imapflow";
import { allRows, db, loadCredentials, must } from "../src/db";
import { parseEmail } from "../src/ingest/normalize-email";
import { ICLOUD_IMAP, type ICloudCredentials } from "../src/connectors/icloud";

// One-off: reads the List-Unsubscribe headers of mail imported before they were stored. Only the
// headers are fetched, not whole messages. Safe to run again.

const accounts = must(await db.from("accounts").select("id").eq("provider", "icloud"), "load accounts");
for (const account of accounts) {
  const creds = await loadCredentials<ICloudCredentials>(account.id);
  const client = new ImapFlow({ ...ICLOUD_IMAP, auth: { user: creds.username, pass: creds.password }, logger: false });
  await client.connect();
  // Every row is loaded, a page at a time, before any is updated: an update takes a row out of the filter.
  const rows = await allRows(
    (from, to) =>
      db
        .from("messages")
        .select("id, provider_meta")
        .eq("account_id", account.id)
        .eq("direction", "inbound")
        .is("list_unsubscribe", null)
        .order("id")
        .range(from, to),
    "load messages",
  );
  const byFolder = new Map<string, Map<number, string>>();
  for (const r of rows) {
    const meta = r.provider_meta as { folder?: string; uid?: number };
    if (!meta.folder || !meta.uid) continue;
    byFolder.set(meta.folder, (byFolder.get(meta.folder) ?? new Map()).set(meta.uid, r.id));
  }
  let found = 0;
  for (const [folder, ids] of byFolder) {
    const lock = await client.getMailboxLock(folder);
    try {
      for await (const msg of client.fetch([...ids.keys()], { uid: true, headers: ["list-unsubscribe", "list-unsubscribe-post"] }, { uid: true })) {
        if (!msg.headers || msg.headers.length < 5) continue;
        const mail = await parseEmail(msg.headers, "x");
        if (!mail.listUnsubscribe) continue;
        must(
          await db.from("messages").update({ list_unsubscribe: mail.listUnsubscribe, list_unsubscribe_post: mail.listUnsubscribePost }).eq("id", ids.get(msg.uid)!),
          "save header",
        );
        found++;
      }
    } finally {
      lock.release();
    }
  }
  await client.logout();
  console.log(`account ${account.id}: ${rows.length} checked, ${found} with unsubscribe headers`);
}
