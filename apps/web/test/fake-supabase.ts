// The Supabase client the screen tests get in place of lib/supabase.ts (test/supabase-hook.ts swaps it in). Nothing
// here talks to a server: every query is recorded and answered from memory, empty unless a test says otherwise. Tests
// import `fakeSupabase` to set answers and read the record; components import `supabase` as usual.

import type { Session } from "@supabase/supabase-js";
import type { supabase as RealClient } from "@/lib/supabase";

/** One chain of calls on the client, such as from("outbox").insert({...}).select("id").single(). */
export interface FakeCall {
  /** What started the chain: "from:outbox", "rpc:track", "channel:inbox", "storage:avatars", "functions:invoke". */
  root: string;
  /** The root's own arguments, then each chained method with its arguments, in order. */
  steps: { name: string; args: unknown[] }[];
}

/** What an awaited query resolves to. */
export interface FakeAnswer { data: unknown; error: { message: string; code?: string } | null; count?: number | null }

/** A made-up signed-in session: an example.com user with a token that opens nothing. */
export const FAKE_SESSION = {
  access_token: "fake-access-token", refresh_token: "fake-refresh-token", token_type: "bearer", expires_in: 3600,
  expires_at: 4_102_444_800, // 2100-01-01, so nothing tries to refresh it
  user: { id: "00000000-0000-4000-8000-000000000001", email: "screen-test-user@example.com", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
} as unknown as Session;

const calls: FakeCall[] = [];
const answers = new Map<string, FakeAnswer | ((call: FakeCall) => FakeAnswer)>();
let session: Session | null = FAKE_SESSION;

/** An empty result shaped like the query: a list for a select, null for single() and for anything else. */
function emptyAnswer(call: FakeCall): FakeAnswer {
  const names = call.steps.map((s) => s.name);
  const single = names.includes("single") || names.includes("maybeSingle");
  const list = call.root.startsWith("from:") && names.includes("select") && !single;
  return { data: list ? [] : null, error: null, count: list ? 0 : null };
}

function answerFor(call: FakeCall): FakeAnswer {
  const set = answers.get(call.root);
  if (!set) return emptyAnswer(call);
  return typeof set === "function" ? set(call) : set;
}

/** A chain that records each method called on it and resolves, when awaited, to the answer for its root. */
function chain(call: FakeCall): unknown {
  return new Proxy(() => undefined, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: FakeAnswer) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(answerFor(call)).then(ok, fail);
      if (typeof prop === "symbol") return undefined;
      return (...args: unknown[]) => { call.steps.push({ name: prop, args }); return chain(call); };
    },
  });
}

function start(root: string, args: unknown[]): unknown {
  const call: FakeCall = { root, steps: [{ name: root.split(":")[0], args }] };
  calls.push(call);
  return chain(call);
}

const auth = {
  getSession: async () => ({ data: { session }, error: null }),
  getUser: async () => ({ data: { user: session?.user ?? null }, error: null }),
  onAuthStateChange: (_cb: unknown) => ({ data: { subscription: { unsubscribe: () => undefined } } }),
  mfa: {
    getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }),
    listFactors: async () => ({ data: { all: [], totp: [] }, error: null }),
  },
  signOut: async () => { calls.push({ root: "auth:signOut", steps: [] }); return { error: null }; },
};

/** Stands in for the real client's surface the app uses; anything else is a recording chain too. */
export const supabase = new Proxy({
  from: (table: string) => start(`from:${table}`, [table]),
  rpc: (name: string, args?: unknown) => start(`rpc:${name}`, [name, args]),
  channel: (name: string) => start(`channel:${name}`, [name]),
  removeChannel: async () => "ok",
  getChannels: () => [],
  storage: { from: (bucket: string) => start(`storage:${bucket}`, [bucket]) },
  functions: { invoke: (name: string, opts?: unknown) => start(`functions:${name}`, [name, opts]) },
  auth,
} as Record<string, unknown>, {
  get(target, prop) {
    if (typeof prop === "symbol" || prop in target) return target[prop as string];
    return (...args: unknown[]) => start(`${prop}:`, args);
  },
}) as unknown as typeof RealClient;

/** The test-facing side: set answers and sessions, read what was called. */
export const fakeSupabase = {
  calls,
  /** Every chain started on this root ("from:outbox"), oldest first. */
  callsTo: (root: string) => calls.filter((c) => c.root === root),
  /** Answers every query on this root with a fixed result, or one worked out from the call. */
  answer(root: string, value: FakeAnswer | ((call: FakeCall) => FakeAnswer)) { answers.set(root, value); },
  /** The session getSession returns: the fake user by default, null for signed out. */
  setSession(next: Session | null) { session = next; },
  /** Forgets calls, answers and the session; setup-dom.ts runs it after every test. */
  reset() { calls.length = 0; answers.clear(); session = FAKE_SESSION; },
};
