import { createClient } from "@supabase/supabase-js";
import type { Database } from "@messages/db";

// Browser client. It uses the publishable key, so what it can read is decided by row-level security:
// a signed-in user sees only their own rows. The session is kept in local storage.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local");
}

export const supabase = createClient<Database>(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
