// Whether the linked WhatsApp account is a Business account, which is when its labels are worth syncing. A Business account has
// a business profile; a personal one has none. Asked once per link by connectors/whatsapp.ts.

import { jidNormalizedUser, type WASocket } from "baileys";

/**
 * True for a Business account, false for a personal one, null when WhatsApp could not say (so the caller can ask again later).
 * `sock` is narrowed to what is used, so tests pass a stand-in.
 */
export async function isBusinessAccount(sock: { user?: { id: string } | null; getBusinessProfile: WASocket["getBusinessProfile"] }): Promise<boolean | null> {
  const id = sock.user?.id;
  if (!id) return null;
  try {
    return !!(await sock.getBusinessProfile(jidNormalizedUser(id)));
  } catch (err) {
    // A personal account's lookup is answered with "item not found" (404): that is a no, not a failure.
    return (err as { output?: { statusCode?: number } }).output?.statusCode === 404 ? false : null;
  }
}
