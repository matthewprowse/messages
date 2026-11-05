// The screen tests' firewall (docs/TESTING.md, "The Safety Rule"): every way a component could reach a server is
// replaced by one that throws and remembers the address. Code that swallows the error still fails its test, because
// setup-dom.ts checks the record after every test. Installed once per test file by setup-dom.ts.

import http from "node:http";
import https from "node:https";

/** Addresses something tried to reach since the last check, oldest first. */
const blocked: string[] = [];

/** The error a blocked call throws. Exported so the guard's own test can tell it apart from any other failure. */
export class BlockedNetworkError extends Error {
  constructor(readonly kind: string, readonly address: string) {
    super(`Screen tests never use the network: ${kind} to ${address} was blocked.`);
    this.name = "BlockedNetworkError";
  }
}

/** The address of whatever a fetch, XHR or socket was handed (a string, a URL or a Request). */
function addressOf(target: unknown): string {
  if (typeof target === "string") return target;
  if (target instanceof URL) return target.href;
  if (target && typeof target === "object" && "url" in target) return String((target as { url: unknown }).url);
  if (target && typeof target === "object" && "host" in target) return `${(target as { host?: string }).host ?? ""}${(target as { path?: string }).path ?? ""}`;
  return String(target);
}

function block(kind: string, target: unknown): never {
  const address = addressOf(target);
  blocked.push(`${kind} ${address}`);
  throw new BlockedNetworkError(kind, address);
}

/** A socket class that cannot be constructed, standing in for WebSocket and EventSource (both take the address first). */
function blockedSocket(kind: string) {
  return class { constructor(target: unknown) { block(kind, target); } };
}

/** XMLHttpRequest learns its address only in open(), so that is where it stops; send() without open() stops too. */
class BlockedXhr {
  open(_method: string, url: unknown) { block("XMLHttpRequest", url); }
  send() { block("XMLHttpRequest", "(not opened)"); }
}

/** Replaces every network entry point on the global object (which is also `window` under happy-dom) and Node's own. */
export function installNetworkGuard() {
  const g = globalThis as Record<string, unknown>;
  g.fetch = (input: unknown) => Promise.reject(blockedSafely("fetch", input));
  g.XMLHttpRequest = BlockedXhr;
  g.WebSocket = blockedSocket("WebSocket");
  g.EventSource = blockedSocket("EventSource");
  const nav = g.navigator as Record<string, unknown> | undefined;
  if (nav) Object.defineProperty(nav, "sendBeacon", { configurable: true, value: (url: unknown) => block("sendBeacon", url) });
  for (const [name, mod] of [["http", http], ["https", https]] as const) {
    const m = mod as unknown as Record<string, unknown>;
    m.request = (target: unknown) => block(`${name}.request`, target);
    m.get = (target: unknown) => block(`${name}.get`, target);
  }
}

/** fetch rejects rather than throws, as the real one does, so callers' .catch handlers run; it is still recorded. */
function blockedSafely(kind: string, target: unknown): BlockedNetworkError {
  try { return block(kind, target); } catch (e) { return e as BlockedNetworkError; }
}

/** Empties the record and returns what was in it, so a test that expects a block can clear it. */
export function takeBlocked(): string[] {
  return blocked.splice(0, blocked.length);
}
