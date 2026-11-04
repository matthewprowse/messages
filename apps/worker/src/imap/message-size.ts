// The size limit on IMAP mail held in memory. Pure: no network. sync-folder.ts reads each message's RFC822.SIZE before
// downloading, and a message over the limit is stored from its headers alone with a short note, so one huge mail (sent
// by anyone) cannot exhaust the worker's memory, and still shows up in the inbox instead of vanishing.

/** Mail larger than this is not downloaded whole. Real providers cap incoming mail around 25 to 50 MB. */
export const MESSAGE_MAX_BYTES = 50 * 1024 * 1024;

/** The body an oversize message is stored with. Plain words, no content of the mail itself. */
export const OVERSIZE_NOTE = "This email is over 50 MB, too large to download here. Open it in your mail app to read it and its attachments.";

/** Consecutive UIDs that share a kind (small or too large), in UID order, so each run is one IMAP fetch. */
export function sizeRuns(sizes: readonly { uid: number; size?: number }[], maxBytes = MESSAGE_MAX_BYTES): { big: boolean; uids: number[] }[] {
  const runs: { big: boolean; uids: number[] }[] = [];
  for (const { uid, size } of [...sizes].sort((a, b) => a.uid - b.uid)) {
    const big = (size ?? 0) > maxBytes;
    const last = runs.at(-1);
    if (last && last.big === big) last.uids.push(uid);
    else runs.push({ big, uids: [uid] });
  }
  return runs;
}

/**
 * A small stand-in message: the original header block with its Content-* fields swapped for a plain text one, and
 * OVERSIZE_NOTE as the body. Sender, subject, date and threading headers (Message-ID, References) are kept as sent.
 */
export function oversizeSource(headers: Buffer): Buffer {
  const fields: string[] = [];
  for (const line of headers.toString("latin1").split(/\r?\n/)) {
    if (line === "") continue;
    if (/^[ \t]/.test(line) && fields.length) fields[fields.length - 1] += `\r\n${line}`;
    else fields.push(line);
  }
  const kept = fields.filter((f) => !/^content-[\w-]*\s*:/i.test(f) && !/^mime-version\s*:/i.test(f));
  const head = [...kept, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit"].join("\r\n");
  return Buffer.concat([Buffer.from(`${head}\r\n\r\n`, "latin1"), Buffer.from(`${OVERSIZE_NOTE}\r\n`, "utf8")]);
}
