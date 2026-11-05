// The service-role database client the seed and the fake worker use. It can only be made for the
// Konva Test project: the address is checked on every call, so a changed setting can never point it at production.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@messages/db";
import { assertTestUrl, loadTestEnv } from "./test-env";

export type Admin = SupabaseClient<Database>;

let client: Admin | null = null;

/** The service-role client for Konva Test. Throws (before any request) unless the address is exactly the test project. */
export function admin(): Admin {
  const env = loadTestEnv();
  const url = assertTestUrl(env.SUPABASE_URL);
  client ??= createClient<Database>(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
