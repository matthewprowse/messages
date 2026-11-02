// Where a signature goes on an email, and the rule that stops it appearing twice. The web app adds it when the email is
// queued (the worker sends the body as it finds it), so a draft, an AI draft and a typed reply all end the same way.
// Pure: composer.tsx and the New Email dialog call it.

import type { Channel } from "./types";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Only email carries a signature: a WhatsApp, LinkedIn or Instagram message is a chat. */
export function carriesSignature(channel: Channel): boolean {
  return channel === "email";
}

/**
 * The body with the signature below it after a blank line. Unchanged when there is no signature, no text (a file
 * on its own goes out as it is), or the body already ends with it, as when you pasted it or the AI wrote it.
 */
export function appendSignature(body: string, signature: string): string {
  const sig = signature.trim();
  if (!sig || !body.trim()) return body;
  if (squash(body).endsWith(squash(sig))) return body;
  return `${body.trimEnd()}\n\n${sig}`;
}
