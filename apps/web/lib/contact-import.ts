// Reading a vCard or CSV file of contacts, and planning what importing it would do to the contacts already held: add a
// new person, add the missing details to someone already there, or skip a row. The preview dialog shows the plan before
// anything is saved. Pure: contact-transfer-io.ts applies it.

import { normalisePhone } from "./new-items";

/** One row of a file, before it is matched to anyone. */
export interface ImportRow {
  name: string;
  /** Lowercased. */
  emails: string[];
  /** As written; checked when the plan is made. */
  phones: string[];
  company: string;
  role: string;
  relationship: string;
  about: string;
  vip: boolean;
}

/** The most rows one import takes, so a mistaken file cannot flood the account. */
export const MAX_IMPORT_ROWS = 500;

const empty = (): ImportRow => ({ name: "", emails: [], phones: [], company: "", role: "", relationship: "", about: "", vip: false });

/** Undoes safeCell (contact-export.ts): an apostrophe put in front of a formula-looking cell. */
const unsafeCell = (v: string) => (/^'[=@+-]/.test(v) ? v.slice(1) : v);

const uniq = <T,>(list: T[]) => [...new Set(list)];

// ---------------------------------------------------------------------------------------------------------
// vCard
// ---------------------------------------------------------------------------------------------------------

const unescapeVcard = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** Splits at the first unescaped separator, or at none. */
function splitUnescaped(text: string, sep: string): string[] {
  const out: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) current += text[i] + text[++i];
    else if (text[i] === sep) { out.push(current); current = ""; }
    else current += text[i];
  }
  out.push(current);
  return out;
}

/** The cards in a .vcf file. Unfolds continuation lines, ignores properties it does not use, and skips a card with nothing to use. */
export function parseVcards(text: string): ImportRow[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: ImportRow[] = [];
  let card: ImportRow | null = null;
  let structured = "";
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VCARD") { card = empty(); structured = ""; continue; }
    if (upper === "END:VCARD") {
      if (card) {
        if (!card.name) card.name = structured;
        if (card.name || card.emails.length || card.phones.length) out.push(card);
      }
      card = null;
      continue;
    }
    if (!card) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    // "item1.EMAIL;TYPE=WORK" is EMAIL: Apple writes a group prefix before the name.
    const key = line.slice(0, colon).split(";")[0].split(".").pop()?.toUpperCase() ?? "";
    const raw = line.slice(colon + 1);
    const value = unescapeVcard(raw).trim();
    if (!value) continue;
    if (key === "FN") card.name = value;
    else if (key === "N") {
      const [family = "", given = ""] = splitUnescaped(raw, ";").map((p) => unescapeVcard(p).trim());
      structured = [given, family].filter(Boolean).join(" ");
    } else if (key === "EMAIL") card.emails.push(value.toLowerCase());
    else if (key === "TEL") card.phones.push(value);
    else if (key === "ORG") card.company = unescapeVcard(splitUnescaped(raw, ";")[0]).trim();
    else if (key === "TITLE") card.role = value;
    else if (key === "CATEGORIES") card.relationship = unescapeVcard(splitUnescaped(raw, ",")[0]).trim();
    else if (key === "NOTE") card.about = value;
    else if (key === "X-KONVA-STARRED") card.vip = value === "1";
  }
  return out.map((c) => ({ ...c, emails: uniq(c.emails), phones: uniq(c.phones) }));
}

// ---------------------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------------------

/** Rows of cells, with quotes, doubled quotes and line breaks inside quotes handled. The delimiter is "," or ";" by the first line. */
export function parseCsvRows(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

type Column = "name" | "first" | "last" | "email" | "phone" | "company" | "role" | "relationship" | "about" | "vip";

// Header words from our own export, Google Contacts, Outlook and Excel lists. The first pattern that matches a header wins.
const HEADERS: [Column, RegExp][] = [
  ["first", /^(first|given)( name)?$/],
  ["last", /^(last|family|sur)( ?name)?$/],
  ["name", /^(full |display |contact )?name$/],
  ["email", /e-?mail/],
  ["phone", /(phone|mobile|cell|tel)/],
  ["company", /^(company|organi[sz]ation|employer|business)( name)?$|^organi[sz]ation \d+ - name$/],
  ["role", /^(role|job ?title|title|position|organi[sz]ation \d+ - title)$/],
  ["relationship", /^(relationship|category|categories)$/],
  ["about", /^(about|notes?|comments?)$/],
  ["vip", /^(starred|vip|favou?rite)$/],
];

/** The cells of a row that a column kind collects, trimmed. Several columns may share a kind (Email 1, Email 2). */
function collect(row: string[], columns: (Column | null)[], kind: Column): string[] {
  return columns.flatMap((c, i) => (c === kind && row[i]?.trim() ? [unsafeCell(row[i].trim())] : []));
}

/** The contacts in a CSV with a header row. A file whose header has no name, email or phone column gives nothing. */
export function parseCsv(text: string): ImportRow[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const columns = rows[0].map((h) => {
    const header = h.trim().toLowerCase().replace(/\s+/g, " ");
    // Google writes "E-mail 1 - Label" ("Work") next to "E-mail 1 - Value": only the value is an address.
    if (/ - (label|type)$/.test(header)) return null;
    return HEADERS.find(([, re]) => re.test(header))?.[0] ?? null;
  });
  if (!columns.some((c) => c === "name" || c === "first" || c === "email" || c === "phone")) return [];
  const out: ImportRow[] = [];
  for (const row of rows.slice(1)) {
    const joined = [...collect(row, columns, "first"), ...collect(row, columns, "last")].join(" ");
    const r: ImportRow = {
      name: collect(row, columns, "name")[0] ?? joined,
      emails: uniq(collect(row, columns, "email").flatMap((c) => c.split(/[;,\s]+/)).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"))),
      phones: uniq(collect(row, columns, "phone").flatMap((c) => c.split(/[;/]|\s:::\s/)).map((p) => p.trim()).filter(Boolean)),
      company: collect(row, columns, "company")[0] ?? "",
      role: collect(row, columns, "role")[0] ?? "",
      relationship: collect(row, columns, "relationship")[0] ?? "",
      about: collect(row, columns, "about")[0] ?? "",
      vip: /^(yes|true|1|y)$/i.test(collect(row, columns, "vip")[0] ?? ""),
    };
    if (r.name || r.emails.length || r.phones.length) out.push(r);
  }
  return out;
}

/** Reads a file's text as vCard or CSV, whichever it is. */
export function parseContactFile(text: string): ImportRow[] {
  return /^\s*BEGIN:VCARD/i.test(text) ? parseVcards(text) : parseCsv(text);
}

// ---------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------

/** Who is already held, as far as matching needs. */
export interface KnownContact {
  id: string;
  name: string;
  emails: string[];
  /** E.164 or as stored. */
  phones: string[];
}

export type ImportAction = "create" | "merge" | "skip";

/** What one row will do. */
export interface ImportItem {
  row: ImportRow;
  action: ImportAction;
  /** The name to use: the row's own, else its first address or number. */
  name: string;
  /** For a merge: who the row matched. */
  target?: KnownContact;
  /** Addresses and numbers (E.164) not yet on the target, or all of them for a new person. */
  emails: string[];
  phones: string[];
  /** Why the row is skipped, or a note about a number that could not be read. */
  note?: string;
}

/** The same number written two ways, compared as digits only. */
const digits = (p: string) => p.replace(/\D/g, "");

/**
 * What importing these rows would do. A row that shares an address or number with someone already held is merged into
 * them (only what is missing is added); a row repeating an earlier row of the same file is skipped; everything else is a
 * new person. Numbers are made E.164 with the user's country code, and one that cannot be read is dropped with a note.
 */
export function planImport(rows: ImportRow[], known: KnownContact[], country: string): ImportItem[] {
  const byEmail = new Map<string, KnownContact>();
  const byPhone = new Map<string, KnownContact>();
  for (const k of known) {
    for (const e of k.emails) byEmail.set(e.toLowerCase(), k);
    for (const p of k.phones) byPhone.set(digits(p), k);
  }
  const seen = new Set<string>();
  return rows.map((row): ImportItem => {
    const phones = uniq(row.phones.flatMap((p) => normalisePhone(p, country) ?? []));
    const unreadable = row.phones.length - row.phones.filter((p) => normalisePhone(p, country)).length;
    const note = unreadable > 0 ? `${unreadable === 1 ? "A number" : `${unreadable} numbers`} could not be read and will be left out.` : undefined;
    const name = row.name.trim() || row.emails[0] || phones[0] || "";
    const base = { row, name, emails: row.emails, phones };
    if (!name) return { ...base, action: "skip", emails: [], phones: [], note: "No name, address or number." };
    const keys = [...row.emails, ...phones.map(digits)];
    if (keys.some((k) => seen.has(k))) return { ...base, action: "skip", note: "Same person as an earlier row." };
    keys.forEach((k) => seen.add(k));
    const target = row.emails.map((e) => byEmail.get(e)).find(Boolean) ?? phones.map((p) => byPhone.get(digits(p))).find(Boolean);
    if (!target) return { ...base, action: "create", note };
    const have = new Set([...target.emails.map((e) => e.toLowerCase()), ...target.phones.map(digits)]);
    return { ...base, action: "merge", target, emails: row.emails.filter((e) => !have.has(e)), phones: phones.filter((p) => !have.has(digits(p))), note };
  });
}

/** How many rows of each kind a plan holds, for the preview's summary. */
export function summarisePlan(plan: ImportItem[]): Record<ImportAction, number> {
  const out = { create: 0, merge: 0, skip: 0 };
  for (const i of plan) out[i.action]++;
  return out;
}
