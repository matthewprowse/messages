// Tests for packages/mail-servers/src/net.ts. Pin down that name lookups answer with public addresses only and
// that private or metadata addresses are refused.

import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchText, pinnedGet, vettedLookup, type Resolver } from "./net";

const answering = (...addresses: string[]): Resolver => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
const ask = (resolve: Resolver, options: { all?: boolean } = {}) =>
  new Promise<{ err: Error | null; address?: unknown }>((done) => vettedLookup(resolve)("example.com", options, (err, address) => done({ err, address })));

test("vettedLookup answers with a public address only", async () => {
  const ok = await ask(answering("93.184.216.34"));
  assert.equal(ok.err, null);
  assert.equal(ok.address, "93.184.216.34");
  assert.equal((await ask(answering("127.0.0.1"))).err?.message, "not a public address");
  assert.equal((await ask(answering("93.184.216.34", "10.0.0.5"))).err?.message, "not a public address");
  assert.equal((await ask(answering("169.254.169.254"), { all: true })).err?.message, "not a public address");
  assert.ok((await ask(async () => [])).err);
});

test("a host that rebinds to a private address is never connected to", async () => {
  // The resolver is asked at connect time; here it answers privately, as a rebinding attacker would.
  await assert.rejects(pinnedGet(new URL("https://rebind.example.com/"), 2000, {}, answering("192.168.1.1")));
  assert.equal(await fetchText("https://rebind.example.com/x", 2000, answering("127.0.0.1")), null);
});

test("only https on port 443, without credentials, to a public address", async () => {
  await assert.rejects(pinnedGet(new URL("http://example.com/"), 1000));
  await assert.rejects(pinnedGet(new URL("https://example.com:8443/"), 1000));
  await assert.rejects(pinnedGet(new URL("https://u:p@example.com/"), 1000));
  await assert.rejects(pinnedGet(new URL("https://127.0.0.1/"), 1000));
  await assert.rejects(pinnedGet(new URL("https://[::1]/"), 1000));
});
