// Groups messages with missing files by the IMAP folder they are stored in. Pure: no network, no database. Used by
// imap/missing-files.ts, which fetches each group again.

export interface MissingMessage {
  message_id: string;
  provider_meta: unknown;
}

/** The missing messages grouped by the folder they are stored in. Rows with no folder, UID or UIDVALIDITY are skipped. */
export function groupByFolder(todo: MissingMessage[]) {
  const byFolder = new Map<string, { uidValidity: number; messages: Map<number, string> }>();
  for (const r of todo) {
    const meta = r.provider_meta as { folder?: string; uid?: number; uid_validity?: number };
    if (!meta.folder || !meta.uid || !meta.uid_validity) continue;
    const entry = byFolder.get(meta.folder) ?? { uidValidity: meta.uid_validity, messages: new Map() };
    if (entry.uidValidity === meta.uid_validity) entry.messages.set(meta.uid, r.message_id);
    byFolder.set(meta.folder, entry);
  }
  return byFolder;
}
