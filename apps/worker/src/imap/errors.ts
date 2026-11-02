// Telling an IMAP connection failure from a database one, and the plain sentences users see when a send or a mail
// action fails. Pure: no network, no database. Used by connectors/imap.ts.

import { ImapFlowErrorCode } from "imapflow";

const IMAP_CODES = new Set<string>(Object.values(ImapFlowErrorCode));

/** Whether a failure came from the IMAP connection (an ImapFlow code, or a NO or BAD reply) rather than the database. */
export function isImapError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; responseStatus?: unknown };
  if (e.responseStatus !== undefined) return true;
  return typeof e.code === "string" && (IMAP_CODES.has(e.code) || e.code.startsWith("ParserError"));
}

/** The service's own words, from MailService (connectors/mail-service.ts). */
export interface ServiceNames {
  name: string;
  password: string;
  object: string;
  trashName: string;
}

/**
 * A dropped connection or timeout with no reply from the server can come after the message was handed over,
 * so it may have gone out. Saying "try again" would invite a second copy.
 */
export function maybeSent(err: { code?: string; command?: string; responseCode?: number }): boolean {
  return err.responseCode === undefined && (err.command === "DATA" || ["ETIMEDOUT", "ESOCKET", "ECONNECTION"].includes(err.code ?? ""));
}

/** Why a reply or new email failed to send, from the SMTP error. kind is "reply" or "email". */
export function sendFailureReason(err: { code?: string; command?: string; responseCode?: number }, kind: string, service: Pick<ServiceNames, "name" | "password">): string {
  const { name, password } = service;
  return err.responseCode === 552
    ? `${name} refused the ${kind} because it is too large. Remove an attachment, then send again.`
    : err.code === "EAUTH"
    ? `${name} rejected the ${password}, so the ${kind} was not sent.`
    : err.code === "EENVELOPE"
      ? `${name} refused the From address or a recipient, so the ${kind} was not sent.`
      : maybeSent(err)
        ? `The ${kind} may have been sent. Check your Sent folder before sending again.`
        : `The ${kind} could not be sent. Try again.`;
}

/** Why a mail action failed, from the error's code (NO_ARCHIVE, NO_TRASH, NO_JUNK, or anything else). */
export function actionFailureReason(code: string | undefined, service: ServiceNames): string {
  const { name, object, trashName } = service;
  return code === "NO_ARCHIVE"
    ? `${name} has no Archive folder.`
    : code === "NO_TRASH"
      ? `${name} has no ${trashName} folder.`
      : code === "NO_JUNK"
        ? `${name} has no Junk folder.`
        : `Could not update ${object}. It will match on the next change.`;
}
