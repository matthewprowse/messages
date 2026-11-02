// The real AuthCall for re-authentication (reauth.ts): one POST to Supabase Auth's REST API with the publishable key. No
// supabase-js client, so no session is created or kept here. Server only.

import type { AuthCall } from "./reauth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Null when the server has no Supabase URL or publishable key. */
export const authCall: AuthCall | null =
  url && key
    ? async (path, body, bearer) => {
        const response = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: key, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        return { ok: response.ok, json };
      }
    : null;
