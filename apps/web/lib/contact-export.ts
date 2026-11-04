// Contacts as a CSV (for Excel) or a vCard file (for address books and other CRMs). Built in the browser from text it has
// already opened, so nothing readable goes through the server. Pure: contact-transfer-io.ts reads the rows and downloads
// the file. contact-import.ts reads these same two formats back.

/** One contact as written to a file. */
export interface ExportContact {
  name: string;
  emails: string[];
  phones: string[];
  company: string;
  role: string;
  relationship: string;
  about: string;
  vip: boolean;
}

export const CSV_HEADER = ["Name", "Emails", "Phones", "Company", "Role", "Relationship", "About", "Starred"] as const;

/**
 * A spreadsheet runs a cell that starts with = or @ (and + or - when it is not a number) as a formula, and a contact's name
 * or note comes from other people. Such a cell gets a leading apostrophe, which contact-import.ts removes again. A leading
 * tab or carriage return gets one too: some spreadsheets drop it and then read the formula behind it.
 */
export function safeCell(value: string): string {
  return /^[=@\t\r]/.test(value) || (/^[+-]/.test(value) && !/^[+-]?[\d\s().-]+$/.test(value)) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const text = safeCell(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The CSV for these contacts: a header row, then one row each, several emails or phones separated by "; ". CRLF line ends. */
export function toCsv(contacts: ExportContact[]): string {
  const rows = contacts.map((c) => [c.name, c.emails.join("; "), c.phones.join("; "), c.company, c.role, c.relationship, c.about, c.vip ? "Yes" : ""]);
  return [CSV_HEADER as readonly string[], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const escapeVcard = (v: string) => v.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");

/** A line folded to 75 characters as vCard asks: each continuation starts with one space. */
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join("\r\n");
}

/** One vCard 3.0 card. The name is also split into family and given parts, as address books expect. */
export function toVcard(c: ExportContact): string {
  const words = c.name.trim().split(/\s+/);
  const family = words.length > 1 ? words[words.length - 1] : "";
  const given = words.length > 1 ? words.slice(0, -1).join(" ") : words[0] ?? "";
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVcard(c.name)}`,
    `N:${escapeVcard(family)};${escapeVcard(given)};;;`,
    ...c.emails.map((e) => `EMAIL;TYPE=INTERNET:${escapeVcard(e)}`),
    ...c.phones.map((p) => `TEL;TYPE=CELL:${escapeVcard(p)}`),
    ...(c.company ? [`ORG:${escapeVcard(c.company)}`] : []),
    ...(c.role ? [`TITLE:${escapeVcard(c.role)}`] : []),
    ...(c.relationship ? [`CATEGORIES:${escapeVcard(c.relationship)}`] : []),
    ...(c.about ? [`NOTE:${escapeVcard(c.about)}`] : []),
    ...(c.vip ? ["X-KONVA-STARRED:1"] : []),
    "END:VCARD",
  ];
  return lines.map(foldLine).join("\r\n");
}

/** A vCard file with one card per contact. */
export function toVcards(contacts: ExportContact[]): string {
  return contacts.map(toVcard).join("\r\n") + "\r\n";
}
