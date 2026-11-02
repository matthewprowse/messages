// The file formats of Download My Data: CSV, vCard, iCalendar and the readable text of a conversation. Pure string building with
// no network and no keys; export-run.ts feeds it text the browser has already opened.

/** One CSV field. Quoted when it holds a comma, quote or line break. A leading = + - or @ gets a quote mark in front so a spreadsheet never runs it as a formula. */
export function csvField(value: string | number | null | undefined): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV document with a header row, CRLF line ends and a leading byte order mark so Excel reads the accents. */
export function toCsv(columns: string[], rows: (string | number | null | undefined)[][]): string {
  return `\uFEFF${[columns, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n")}\r\n`;
}

/** A vCard value: backslash, comma, semicolon and line breaks escaped as RFC 6350 asks. */
const vcardText = (v: string) => v.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

export interface ExportContact { name: string; emails: string[]; phones: string[]; company?: string; role?: string }

/** One vCard 3.0 card (the version every address book reads). */
export function vcard(c: ExportContact): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${vcardText(c.name || "Unnamed")}`];
  if (c.company) lines.push(`ORG:${vcardText(c.company)}`);
  if (c.role) lines.push(`TITLE:${vcardText(c.role)}`);
  for (const e of c.emails) lines.push(`EMAIL;TYPE=INTERNET:${vcardText(e)}`);
  for (const p of c.phones) lines.push(`TEL:${vcardText(p)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

/** Every contact as one .vcf file. */
export const vcards = (contacts: ExportContact[]): string => contacts.map(vcard).join("\r\n") + (contacts.length ? "\r\n" : "");

/** An iCalendar line folded at 75 octets of characters as RFC 5545 asks (continuation lines start with a space). */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 73) parts.push(line.slice(i, i + 73));
  return parts.join("\r\n ");
}

const icsText = (v: string) => v.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const icsStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsDate = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

export interface ExportEvent { id: string; title: string; startsAt: string; endsAt: string | null; allDay: boolean; location?: string | null; description?: string | null; recurrence?: string | null }

/** One calendar as .ics. An all-day event is stored at midnight UTC of its day with an end date that is not included, which is how iCalendar writes it too. */
export function icsCalendar(events: ExportEvent[], now: Date = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Konva//Download My Data//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.id}@konva`, `DTSTAMP:${icsStamp(now.toISOString())}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(e.startsAt)}`);
      if (e.endsAt) lines.push(`DTEND;VALUE=DATE:${icsDate(e.endsAt)}`);
    } else {
      lines.push(`DTSTART:${icsStamp(e.startsAt)}`);
      if (e.endsAt) lines.push(`DTEND:${icsStamp(e.endsAt)}`);
    }
    lines.push(`SUMMARY:${icsText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.recurrence) lines.push(e.recurrence.startsWith("RRULE:") ? e.recurrence : `RRULE:${e.recurrence}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** A file name safe on every system: no slashes or control characters, no leading dot, at most 80 characters. */
export function safeName(name: string, fallback = "Untitled"): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 80).trim();
  return clean || fallback;
}

/** `dir/name.ext`, made unique among `taken` by adding a number before the extension. Records the result in `taken`. */
export function uniquePath(taken: Set<string>, dir: string, name: string, ext: string): string {
  let path = `${dir}/${name}${ext}`;
  for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${dir}/${name} (${n})${ext}`;
  taken.add(path.toLowerCase());
  return path;
}

export interface ExportLine { sentAt: string; direction: "in" | "out"; who: string; text: string; files: string[] }

/** A conversation as plain text a person can read: a title, then each message with its date and sender. */
export function conversationText(title: string, channel: string, lines: ExportLine[]): string {
  const out = [title, `${channel}, ${lines.length} ${lines.length === 1 ? "message" : "messages"}`, ""];
  for (const l of lines) {
    out.push(`${l.sentAt.slice(0, 16).replace("T", " ")} UTC  ${l.direction === "out" ? "You" : l.who}`);
    if (l.text) out.push(l.text);
    for (const f of l.files) out.push(`[File: ${f}]`);
    out.push("");
  }
  return out.join("\n");
}
