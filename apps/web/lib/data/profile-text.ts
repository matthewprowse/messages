// Which profile columns hold free text that must be sealed, and which of them still hold readable text. Pure, so it
// is tested without a database; profile-seal.ts does the sealing.

import { isCiphertext } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";

export type ProfileTextColumn = "about" | "important_people";

/** The profile columns that are sealed, and the kind of text each holds. */
export const PROFILE_TEXT: { column: ProfileTextColumn; field: Field }[] = [
  { column: "about", field: FIELD.profileAbout },
  { column: "important_people", field: FIELD.profilePeople },
];

/** The columns still holding readable text. Empty values are not worth a write. */
export function plainColumns(row: Partial<Record<ProfileTextColumn, string | null>> | null | undefined): ProfileTextColumn[] {
  if (!row) return [];
  return PROFILE_TEXT.map((t) => t.column).filter((c) => { const v = row[c]; return typeof v === "string" && v !== "" && !isCiphertext(v); });
}
