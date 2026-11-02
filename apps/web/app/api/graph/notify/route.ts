// Where Microsoft Graph sends Outlook change notifications. Public by necessity (Graph cannot sign in), so it trusts
// nothing: the validation handshake only echoes a token, and a notification only counts if its clientState was signed
// with GRAPH_NOTIFY_SECRET by the worker (lib/server/graph-notify.ts). It stores no content and reads none: it writes one
// row per account to mail_hints ("sync this account now"), which the worker hears through Realtime and answers by
// reading the mailbox itself. It always answers 202 to a notification, even a rejected one, so Graph neither retries
// nor learns which clientStates are valid.

import { accountsToHint } from "@/lib/server/graph-notify";
import { admin, noStore } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 256 * 1024;

/** The handshake Graph makes when a subscription is created: echo validationToken as plain text, within 10 seconds. */
function handshake(request: Request): Response | null {
  const token = new URL(request.url).searchParams.get("validationToken");
  if (token === null) return null;
  return new Response(token, { status: 200, headers: { "Content-Type": "text/plain", ...noStore } });
}

export async function POST(request: Request) {
  const echoed = handshake(request);
  if (echoed) return echoed;
  const secret = process.env.GRAPH_NOTIFY_SECRET?.trim();
  if (!secret || !admin) return new Response(null, { status: 202, headers: noStore });
  try {
    const text = await request.text();
    if (text.length <= MAX_BODY_CHARS) {
      const accounts = accountsToHint(JSON.parse(text), secret);
      if (accounts.length > 0) {
        const now = new Date().toISOString();
        await admin.from("mail_hints").upsert(accounts.map((account_id) => ({ account_id, hinted_at: now })), { onConflict: "account_id" });
      }
    }
  } catch {
    // Not JSON, or the write failed: the worker's slow check still finds the mail.
  }
  return new Response(null, { status: 202, headers: noStore });
}
