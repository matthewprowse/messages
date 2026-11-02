// Stops the worker: every connector (bounded by SHUTDOWN_MS), then in-flight hand-offs, then the lease, then exits.

import type { Lease } from "../lease";
import { dispatching, running, stopConnector } from "./state";

const SHUTDOWN_MS = 10_000;

/** Stops every connector (bounded by SHUTDOWN_MS) and exits. Used by a signal and when the lease is lost. */
let stopping = false;
export async function stopAndExit(code: number, lease?: Lease) {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(1), SHUTDOWN_MS).unref(); // a stop() that hangs must not block exit
  await Promise.all([...running.entries()].map(([id, r]) => stopConnector(id, r)));
  // Work already handed to a connector gets to finish (bounded by SHUTDOWN_MS above) before the lease goes.
  while (dispatching.size > 0) await new Promise((resolve) => setTimeout(resolve, 100));
  await lease?.release();
  process.exit(code);
}
