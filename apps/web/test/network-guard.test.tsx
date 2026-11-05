// The screen tests' network guard (network-guard.ts, setup-dom.ts): every way to reach a server throws and names the
// address, a component that swallows the error still fails its test, and lib/supabase is the in-memory fake.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { supabase } from "@/lib/supabase";
import { BlockedNetworkError, takeBlocked } from "./network-guard";
import { fakeSupabase } from "./fake-supabase";

const ADDRESS = "https://api.example.com/v1/things";

/** Runs fn, expects the guard to stop it, and clears the record so this test itself passes. */
async function expectBlocked(kind: string, fn: () => unknown) {
  await assert.rejects(async () => { await fn(); }, (e: unknown) => e instanceof BlockedNetworkError && e.message.includes(ADDRESS) && e.message.includes(kind));
  assert.deepEqual(takeBlocked(), [`${kind} ${ADDRESS}`]);
}

test("fetch, XHR, WebSocket, EventSource, sendBeacon and Node's http all throw and name the address", async () => {
  await expectBlocked("fetch", () => fetch(ADDRESS));
  await expectBlocked("fetch", () => window.fetch(new Request(ADDRESS)));
  await expectBlocked("XMLHttpRequest", () => new XMLHttpRequest().open("GET", ADDRESS));
  await expectBlocked("WebSocket", () => new WebSocket(ADDRESS));
  await expectBlocked("EventSource", () => new EventSource(ADDRESS));
  await expectBlocked("sendBeacon", () => navigator.sendBeacon(ADDRESS));
  await expectBlocked("http.request", () => http.request(ADDRESS));
});

test("a component's fetch is recorded even when the component swallows the error", async () => {
  function Quiet() {
    useEffect(() => { fetch(ADDRESS).catch(() => undefined); }, []);
    return null;
  }
  render(<Quiet />);
  await waitFor(() => assert.deepEqual(takeBlocked(), [`fetch ${ADDRESS}`]));
});

test("a test whose component reaches the network fails, naming the address", async () => {
  // Run in its own process: the failure under test must not fail this file.
  const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
  // NODE_TEST_CONTEXT would make the child report to this runner instead of printing its own result.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const run = promisify(execFile)(here("../node_modules/.bin/tsx"), ["--test", "--import", here("./setup-dom.ts"), here("./fixtures/swallowed-fetch.fixture.tsx")], { env });
  const failed = await run.then(() => null, (e: { code: number; stdout: string }) => e);
  assert.ok(failed, "the fixture test should have failed");
  assert.match(failed.stdout, /This test tried to use the network/);
  assert.match(failed.stdout, /fetch https:\/\/leak\.example\.com\/quiet/);
});

test("lib/supabase is the fake: queries are recorded and answered from memory", async () => {
  fakeSupabase.answer("from:notes", { data: [{ id: "note-1" }], error: null });
  const { data } = await supabase.from("notes").select("id").eq("archived", false);
  assert.deepEqual(data, [{ id: "note-1" }]);
  const [call] = fakeSupabase.callsTo("from:notes");
  assert.deepEqual(call.steps.map((s) => s.name), ["from", "select", "eq"]);
  const empty = await supabase.from("outbox").select("*").maybeSingle();
  assert.equal(empty.data, null);
});
