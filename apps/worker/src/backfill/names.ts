// The names scripts/seal-names.ts seals: contacts.display_name, organizations.name and threads.group_name (audit H5,
// 20261125100000_sealed_names_columns.sql), and how one row is worked out. A group's name also gets the blind index
// ingest tells a rename by. Pure, so it is tested without a database.

import { decryptField, encryptField, isCiphertext, isTeamCiphertext, type UserKeys } from "@messages/crypto";
import { groupNameIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";

export interface NameSpec {
  table: "contacts" | "organizations" | "threads";
  column: "display_name" | "name" | "group_name";
  /** The column holding the name's blind index, for a group's name. */
  index?: "group_name_index";
}

// Smallest first, so a problem shows up before the large table is touched.
export const NAME_SPECS: NameSpec[] = [
  { table: "organizations", column: "name" },
  { table: "threads", column: "group_name", index: "group_name_index" },
  { table: "contacts", column: "display_name" },
];

export type NameMode = "encrypt" | "decrypt";

export interface NamePlan {
  /** The old value of each changed column (null for an index not yet set), so the write lands only if nothing changed. */
  expect: Record<string, string | null>;
  set: Record<string, string | null>;
}

/**
 * What to write for one row, or null when it is already in the wanted form. Encrypting seals a readable name with the
 * user's key and indexes a group's name that has no index yet (a sealed one is opened for it); decrypting opens a
 * user-sealed name. A team's value (t1:, a shared chat's group name) is left as it is: the share job keeps it. Throws
 * when a value that is meant to open does not, so a row is never half converted.
 */
export async function planName(keys: UserKeys, spec: NameSpec, row: Record<string, unknown>, mode: NameMode): Promise<NamePlan | null> {
  const value = row[spec.column];
  if (typeof value !== "string" || value === "" || isTeamCiphertext(value)) return null;
  const expect: Record<string, string | null> = {};
  const set: Record<string, string | null> = {};
  if (mode === "decrypt") {
    if (!isCiphertext(value)) return null;
    expect[spec.column] = value;
    set[spec.column] = await decryptField(keys, FIELD.name, value);
    return { expect, set };
  }
  const plain = isCiphertext(value) ? await decryptField(keys, FIELD.name, value) : value;
  if (!isCiphertext(value)) {
    const sealed = await encryptField(keys, FIELD.name, value);
    // Checked before anything is written: it must open back to exactly what was read.
    if ((await decryptField(keys, FIELD.name, sealed)) !== value) throw new Error("does not round-trip");
    expect[spec.column] = value;
    set[spec.column] = sealed;
  }
  if (spec.index && plain.trim()) {
    const index = await groupNameIndex(keys, plain);
    const stored = typeof row[spec.index] === "string" ? (row[spec.index] as string) : null;
    if (stored !== index) {
      expect[spec.index] = stored;
      set[spec.index] = index;
    }
  }
  return Object.keys(set).length ? { expect, set } : null;
}
