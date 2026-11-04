// Opening an outbox row for sending, strictly: every sealed column must have been sealed for this very row and column
// (packages/crypto/src/bound.ts), so a body or an address copied in from elsewhere (a message, another outbox row, another
// user) is refused and the row fails with UNVERIFIED instead of going out. With encryption on, plain text is refused too.
// The opener comes in as a parameter (vault.ts openBound in the worker), so this is tested without keys or a database.

import { FIELD, type Field } from "@messages/crypto/fields";
import type { BoundAt } from "../vault";

/** vault.ts openBound, or a fake in the tests. */
export type BoundOpener = (userId: string, field: Field, value: string | null | undefined, at: BoundAt, kind?: "content" | "address") => Promise<string | null>;

/** What a row that fails the check is failed with. The code is in the log; this sentence is what the app shows. */
export const UNVERIFIED = "Nothing was sent: this message could not be verified. Write it again.";

/** Where an outbox column's value must have been sealed: that column of this row. */
export const outboxAt = (rowId: string, column: string): BoundAt => ({ places: [`outbox.${column}`], row: rowId });

type AddressRow = { id: string; user_id: string; from_address?: string | null; to_addresses?: string[] | null; cc_addresses?: string[] | null; bcc_addresses?: string[] | null };

/** The row with its From, To, Cc and Bcc opened. Throws (with the opener's code) when any will not open here. */
export async function openOutboxAddresses<R extends AddressRow>(row: R, open: BoundOpener): Promise<R> {
  const one = (column: string, v: string | null | undefined) => open(row.user_id, FIELD.address, v, outboxAt(row.id, column), "address");
  const list = async (column: "to_addresses" | "cc_addresses" | "bcc_addresses") => {
    const values = row[column];
    return values == null ? values : Promise.all(values.map(async (v) => (await one(column, v)) ?? ""));
  };
  const [from, to, cc, bcc] = await Promise.all([one("from_address", row.from_address), list("to_addresses"), list("cc_addresses"), list("bcc_addresses")]);
  const out = { ...row, to_addresses: to, cc_addresses: cc, bcc_addresses: bcc };
  if ("from_address" in row) out.from_address = from;
  return out;
}

/** The row's body (and subject, for an email) opened. Throws when either will not open here. */
export async function openOutboxText<R extends { id: string; user_id: string; body: string | null; subject?: string | null }>(row: R, open: BoundOpener): Promise<R & { body: string }> {
  const [body, subject] = await Promise.all([
    open(row.user_id, FIELD.body, row.body, outboxAt(row.id, "body")),
    row.subject === undefined ? undefined : open(row.user_id, FIELD.subject, row.subject, outboxAt(row.id, "subject")),
  ]);
  return subject === undefined ? { ...row, body: body ?? "" } : { ...row, body: body ?? "", subject };
}

/** The stable code of an error from the opener, for the log: sealed_elsewhere, plaintext_refused and so on. */
export const refusalCode = (err: unknown) => (err as { code?: string } | null)?.code ?? "unreadable";
