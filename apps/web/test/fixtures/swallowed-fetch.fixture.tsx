// Not a test of its own: network-guard.test.tsx runs it in a child process to prove that a component which reaches
// the network and swallows the error still fails its test. Its name keeps it out of the test globs.

import { test } from "node:test";
import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";

test("a component that quietly calls out", async () => {
  let tried = false;
  function Leaky() {
    useEffect(() => { fetch("https://leak.example.com/quiet").catch(() => { tried = true; }); }, []);
    return null;
  }
  render(<Leaky />);
  await waitFor(() => { if (!tried) throw new Error("not yet"); });
});
