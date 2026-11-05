// A module hook for the screen tests: every import of lib/supabase.ts (by "@/lib/supabase" or a relative path) gets
// test/fake-supabase.ts instead, so no component can build a real client. Registered by setup-dom.ts.

import { registerHooks } from "node:module";

const REAL = /\/apps\/web\/lib\/supabase\.ts$/;
const FAKE = new URL("./fake-supabase.ts", import.meta.url).href;

/** Points lib/supabase at the fake for the rest of this process. */
export function redirectSupabase() {
  registerHooks({
    resolve(specifier, context, next) {
      const found = next(specifier, context);
      return REAL.test(found.url) ? { ...found, url: FAKE } : found;
    },
  });
}
