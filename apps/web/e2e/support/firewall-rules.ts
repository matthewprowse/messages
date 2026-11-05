// The browser firewall's rules (docs/TESTING.md, The Safety Rule, point 3): which requests a test browser may make. Pure:
// the fixture in fixtures.ts applies them to every request and websocket. Only the test server and the Konva Test
// database are reachable, and of the database not the endpoints that make Supabase send an email.

import { APP_ORIGIN, TEST_HOST } from "./test-env";

/** One request the firewall stopped: where it was going (host and path, never the query or body) and why. */
export interface Blocked {
  host: string;
  path: string;
  kind: "http" | "websocket";
  reason: string;
}

// Supabase Auth endpoints that send an email (a magic link, a code, an invite, a reset, a confirmation). Tests sign in
// with a password, so none of these is ever needed, and blocking them means no test can mail anyone.
const MAILING_AUTH_PATHS = ["/auth/v1/otp", "/auth/v1/magiclink", "/auth/v1/recover", "/auth/v1/signup", "/auth/v1/invite", "/auth/v1/resend"];

/**
 * Whether a request may go out, or why not. `body` is the request's text, when it has one: changing a user's email
 * (PUT /auth/v1/user with an email) mails a confirmation, while the same call saving onboarding flags does not.
 */
export function judge(rawUrl: string, method = "GET", body: string | null = null): Blocked | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { host: "(unreadable address)", path: "", kind: "http", reason: "not a valid address" };
  }
  const kind = url.protocol === "ws:" || url.protocol === "wss:" ? "websocket" : "http";
  // Made in the page itself; they never touch the network.
  if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") return null;
  if (url.origin === APP_ORIGIN && (url.protocol === "http:" || url.protocol === "ws:")) return null;
  if (url.host === TEST_HOST && (url.protocol === "https:" || url.protocol === "wss:")) {
    if (MAILING_AUTH_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) {
      return { host: url.host, path: url.pathname, kind, reason: "an Auth endpoint that sends email" };
    }
    if (url.pathname === "/auth/v1/user" && method === "PUT" && body && /"email"\s*:/.test(body)) {
      return { host: url.host, path: url.pathname, kind, reason: "an email change, which sends a confirmation" };
    }
    return null;
  }
  return { host: url.host || url.protocol, path: url.pathname, kind, reason: "not the test server or the test database" };
}

/** What a test says it expects to be blocked: a host ("gmail.googleapis.com") or a pattern over "host/path". */
export type Expectation = string | RegExp;

/** The blocked requests no expectation covers. A test fails when there are any. */
export function undeclared(blocked: Blocked[], expected: Expectation[]): Blocked[] {
  return blocked.filter((b) => !expected.some((e) => (typeof e === "string" ? b.host === e : e.test(`${b.host}${b.path}`))));
}

/** A failure message naming each unexpected host once, with the path and reason. No query strings or bodies. */
export function describeBlocked(blocked: Blocked[]): string {
  const lines = [...new Set(blocked.map((b) => `${b.kind} to ${b.host}${b.path} (${b.reason})`))];
  return `The test firewall blocked ${lines.length === 1 ? "a request" : "requests"} the test did not expect:\n  ${lines.join("\n  ")}`;
}
