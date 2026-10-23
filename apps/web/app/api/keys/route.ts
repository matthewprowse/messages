import { createClient } from "@supabase/supabase-js";
import type { Database } from "@messages/db";
import { dataKeyFor, localWrapper, type KeyStore } from "@messages/crypto/wrap";

// Hands a signed-in user their data key, so the browser can decrypt their messages itself. The caller
// proves who they are with their Supabase access token; the key is unwrapped here with KEY_WRAPPING_KEY and
// never stored on this server. In Phase 2A this moves into Confidential Space with the workers.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const wrappingKey = process.env.KEY_WRAPPING_KEY;

const admin = url && serviceKey ? createClient<Database>(url, serviceKey, { auth: { persistSession: false } }) : null;

const store: KeyStore | null = admin && {
  async read(userId) {
    const { data, error } = await admin.from("user_keys").select("wrapped_key, wrapped_by").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async insertIfAbsent(row) {
    const { error } = await admin.from("user_keys").upsert(row, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) throw error;
  },
};

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!admin || !store || !wrappingKey) return Response.json({ error: "The key service is not set up." }, { status: 503, headers: noStore });
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return Response.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return Response.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  try {
    const key = await dataKeyFor(store, [await localWrapper(wrappingKey)], data.user.id);
    return Response.json({ key: Buffer.from(key).toString("base64") }, { headers: noStore });
  } catch {
    return Response.json({ error: "Could not open your key." }, { status: 500, headers: noStore });
  }
}
