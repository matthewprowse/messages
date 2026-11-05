// Where Microsoft Graph sends Outlook change notifications. Public by necessity (Graph cannot sign in), so it trusts
// nothing: the validation handshake only echoes a token, and a notification only counts if its clientState was signed
// with GRAPH_NOTIFY_SECRET by the worker (lib/server/graph-notify.ts). It stores no content and reads none: it writes one
// row per account to mail_hints ("sync this account now"), which the worker hears through Realtime and answers by
// reading the mailbox itself. It always answers 202 to a notification, even a rejected one, so Graph neither retries
// nor learns which clientStates are valid. A body over the cap is never read, and hints are limited per sending address and
// per account: a replayed or flooded notification can only ask for a sync the worker would do anyway, and not often.

import { accountsToHint } from "@/lib/server/graph-notify";
import { admin, limitedAddress, limiter, noStore, readCapped } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

// Graph posts from a pool of Microsoft addresses shared by every mailbox, so the per-address limit is generous: 600 a minute.
const overAddressLimit = limiter(600, 60_000, { name: "graph-notify-ip" });
// One mailbox needs a sync at most every few seconds; more hints than 30 a minute change nothing for the worker.
const overAccountLimit = limiter(30, 60_000, { name: "graph-notify-account" });

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
    const address = limitedAddress(request);
    if (!address || (await overAddressLimit(address)) > 0) return new Response(null, { status: 202, headers: noStore });
    const text = await readCapped(request, MAX_BODY_BYTES);
    if (text !== null) {
      const signed = accountsToHint(JSON.parse(text), secret);
      const waits = await Promise.all(signed.map((id) => overAccountLimit(id)));
      const accounts = signed.filter((_, i) => waits[i] === 0);
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
