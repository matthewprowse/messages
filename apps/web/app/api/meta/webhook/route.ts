// Meta's webhook for Instagram messages. GET is the handshake Meta makes when the callback URL is saved; POST is an
// event. A POST is trusted only with a valid X-Hub-Signature-256 (the Instagram app secret over the raw body), and it
// writes content-free hints (lib/meta-webhook.ts) that the Instagram connector in apps/ai turns into an immediate
// read of that account's inbox. Nothing from the payload is kept or logged beyond the account ID and kind.

import { admin, noStore } from "@/lib/server/request";
import { MAX_BODY_BYTES, hintsFromPayload, validSignature, verifyChallenge } from "@/lib/meta-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain", ...noStore } });

export async function GET(request: Request) {
  const challenge = verifyChallenge(new URL(request.url).searchParams, process.env.META_WEBHOOK_VERIFY_TOKEN);
  return challenge === null ? text("Forbidden", 403) : text(challenge, 200);
}

export async function POST(request: Request) {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  if (!secret || !admin) return text("Not configured", 503);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return text("Too large", 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return text("Too large", 413);
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), secret)) return text("Forbidden", 403);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return text("Bad request", 400);
  }
  const hints = hintsFromPayload(payload);
  if (hints.length > 0) {
    const { error } = await admin.from("meta_webhook_hints").insert(hints.map((h) => ({ provider: "instagram", ig_user_id: h.igUserId, kind: h.kind })));
    if (error) return text("Try again", 500); // Meta retries a failed delivery, so a database hiccup loses nothing
  }
  return text("OK", 200);
}
