// Download Selected on the Attachments page: a small ZIP writer (stored, not compressed, since photos and PDFs barely
// shrink and it keeps this dependency free) and the naming rules for what goes inside. Pure: bytes in, a Blob out.

import { displayName, uniqueName } from "../outbox-files";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 a ZIP entry carries. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The names to give files in the archive: cleaned like an attachment name, and "Name 2.pdf" for a repeat. */
export function zipEntryNames(names: string[]): string[] {
  const taken: string[] = [];
  return names.map((n) => {
    const name = uniqueName(displayName(n), taken);
    taken.push(name);
    return name;
  });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Konva Attachments 2 November 2026.zip": no dashes, and the same wherever the browser's locale is. */
export function zipFileName(date: Date): string {
  return `Konva Attachments ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}.zip`;
}

/** The MS-DOS date and time ZIP stores, in local time. Years before 1980 are stored as 1980. */
function dosStamp(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** The most one archive can hold without ZIP64: 65,535 entries and under 4 GB. */
export const ZIP_MAX_ENTRIES = 65_535;
export const ZIP_MAX_BYTES = 4_000_000_000;

/** Whether a set of files fits in one plain ZIP. */
export const fitsZip = (count: number, bytes: number) => count > 0 && count <= ZIP_MAX_ENTRIES && bytes < ZIP_MAX_BYTES;

/** Builds a stored ZIP. Names are written as UTF-8 (flag bit 11), so accents and other scripts survive. */
export function buildZip(entries: { name: string; data: Uint8Array<ArrayBuffer> }[], now = new Date()): Blob {
  const { time, date } = dosStamp(now);
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = encoder.encode(e.name);
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, e.data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true); // made by
    entry.setUint16(6, 20, true); // version needed
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, e.data.length, true);
    entry.setUint32(24, e.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    const record = new Uint8Array(46 + name.length);
    record.set(new Uint8Array(entry.buffer), 0);
    record.set(name, 46);
    central.push(record);
    offset += 30 + name.length + e.data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

/** How a Download Selected run ended: files saved, files with no stored copy, files that failed, or why nothing was built. */
export type ZipOutcome = { saved: number; skipped: number; failed: number; reason?: "too_big" | "none" };

/** What to tell the person once Download Selected has finished. */
export function zipMessage(o: ZipOutcome): string {
  if (o.reason === "none") return "None of these files are stored in Konva, so there is nothing to download.";
  if (o.reason === "too_big") return "These files are too big for one zip. Select fewer, or download them one at a time.";
  if (o.saved === 0) return "The files did not download. Try again.";
  const left = [o.skipped ? `${o.skipped} not stored here` : "", o.failed ? `${o.failed} did not download` : ""].filter(Boolean).join(", ");
  return left ? `Downloaded ${o.saved} ${o.saved === 1 ? "file" : "files"} (${left}).` : `Downloaded ${o.saved} ${o.saved === 1 ? "file" : "files"}.`;
}
