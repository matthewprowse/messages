// Opening what the user wrote (body and subject) before it is sent. Strict on purpose: the lenient open() answers ""
// for a value it cannot decrypt, which would put a blank email on the wire. Kept apart from outbox.ts so it is testable
// without a database.

export type Opener = (value: string | null) => Promise<string | null>;

/** The text the row was queued with, or null when it cannot be opened (the caller fails the row; nothing is sent). A plaintext empty body is fine. */
export async function openOutgoingText<R extends { body: string | null; subject: string | null }>(row: R, openStrict: Opener, openSubject: Opener = openStrict): Promise<(R & { body: string }) | null> {
  try {
    return { ...row, body: (await openStrict(row.body)) ?? "", subject: await openSubject(row.subject) };
  } catch {
    return null;
  }
}
