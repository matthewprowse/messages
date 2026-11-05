// Loaded before every screen test (`--import` in the web "test" script for *.test.tsx): registers the DOM, swaps in
// the fake Supabase client, guards the network, and after each test unmounts what it rendered and fails it if anything
// tried to reach a server. See docs/TESTING.md, "Screen Tests".

import "./register-dom";
import { afterEach } from "node:test";
import { cleanup } from "@testing-library/react";
import { takeBlocked } from "./network-guard";
import { fakeSupabase } from "./fake-supabase";

afterEach(() => {
  cleanup();
  fakeSupabase.reset();
  const blocked = takeBlocked();
  if (blocked.length > 0) throw new Error(`This test tried to use the network:\n  ${blocked.join("\n  ")}`);
});
