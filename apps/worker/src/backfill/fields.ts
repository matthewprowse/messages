import { decryptField, encryptField, isCiphertext, type UserKeys } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import { fileHints } from "../ingest/file-hints";

// The columns scripts/encrypt-fields.ts moves between plain text and ciphertext, and how one row is worked out.
// Pure, so it is tested without a database.

export interface Column {
  column: string;
  field: Field;
}

export interface Spec {
  table: string;
  columns: Column[];
  /** Extra columns to set from the plain values, for the few things SQL still needs. */
  derive?: (plain: Record<string, string | null>) => Record<string, unknown>;
}

export const SPECS: Spec[] = [
  { table: "writing_examples", columns: [{ column: "situation", field: FIELD.writingSituation }, { column: "body", field: FIELD.writingBody }] },
  { table: "style_rules", columns: [{ column: "rule", field: FIELD.styleRule }, { column: "relationship", field: FIELD.styleRelationship }] },
  {
    table: "contacts",
    columns: [
      { column: "company", field: FIELD.contactCompany },
      { column: "role", field: FIELD.contactRole },
      { column: "relationship", field: FIELD.contactRelationship },
      { column: "style_note", field: FIELD.contactStyleNote },
      { column: "ai_summary", field: FIELD.contactSummary },
    ],
  },
  { table: "address_book_cards", columns: [{ column: "name", field: FIELD.cardName }] },
  { table: "calendar_events", columns: [{ column: "title", field: FIELD.eventTitle }, { column: "location", field: FIELD.eventLocation }] },
  { table: "meeting_participants", columns: [{ column: "name", field: FIELD.name }, { column: "address", field: FIELD.address }] },
  {
    // The name is sealed; SQL keeps the extension, receipt hint and sticker flag (20261102400000).
    table: "attachments",
    columns: [{ column: "filename", field: FIELD.filename }],
    derive: (plain) => {
      const name = plain.filename;
      if (name == null) return {};
      const h = fileHints(name);
      return { file_ext: h.ext, keep_hint: h.keep, is_sticker: h.sticker };
    },
  },
];

export type Mode = "encrypt" | "decrypt";

export interface RowPlan {
  /** The old value of each changed column, so the write only lands if nothing changed since the read. */
  expect: Record<string, string | null>;
  set: Record<string, unknown>;
}

/**
 * What to write for one row, or null when it is already in the wanted form. Encrypting seals every readable
 * value; decrypting opens every user-sealed value (a team's t1: value is left alone). Throws if a value that is
 * meant to open does not, so a row is never half converted.
 */
export async function planRow(keys: UserKeys, spec: Spec, row: Record<string, unknown>, mode: Mode): Promise<RowPlan | null> {
  const expect: Record<string, string | null> = {};
  const set: Record<string, unknown> = {};
  const plain: Record<string, string | null> = {};
  for (const { column, field } of spec.columns) {
    const value = row[column];
    if (typeof value !== "string" || value === "") continue;
    if (mode === "encrypt") {
      if (isCiphertext(value)) continue;
      expect[column] = value;
      plain[column] = value;
      set[column] = await encryptField(keys, field, value);
    } else {
      if (!value.startsWith("e1:")) continue;
      const opened = await decryptField(keys, field, value);
      expect[column] = value;
      plain[column] = opened;
      set[column] = opened;
    }
  }
  if (Object.keys(set).length === 0) return null;
  if (mode === "encrypt" && spec.derive) Object.assign(set, spec.derive(plain));
  return { expect, set };
}

// Error columns hold a code and nothing else. A sentence from the provider (or from the AI) is replaced by a generic
// code: it cannot be restored, which is the point.
const CODE = /^[a-z][a-z0-9_]{0,31}$/;
export const ORIGINAL_CODES: Record<string, string> = {
  "This email could not be found.": "not_found",
  "This email is no longer in your mailbox.": "gone",
  "This email has no original layout to show.": "no_layout",
  "Your mailbox could not be reached. Try again.": "unreachable",
};

/** The code to store in place of an error column's text, or null when it already is a code (or empty). */
export function errorCodeFor(table: "email_originals" | "briefs", error: string | null): string | null {
  if (!error || CODE.test(error)) return null;
  if (table === "email_originals" && ORIGINAL_CODES[error]) return ORIGINAL_CODES[error];
  return "failed";
}
