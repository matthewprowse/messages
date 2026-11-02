// libsignal, which Baileys uses for end-to-end encryption, writes whole Signal sessions to the console
// ("Closing session: SessionEntry {...}"), private keys included. This fails closed: a console call is dropped when the
// stack that made it passes through libsignal or Baileys, whatever its wording, so a reworded or new libsignal line cannot
// leak. Lines with the known wording are dropped too (their origin cannot be seen when a library calls from a callback),
// and failures to decrypt are counted instead. Everything else still reaches the console, but with anything key-shaped
// (long hex or base64 runs, raw bytes) blanked. The worker's own logs are JSON lines and pass untouched.

import { log } from "../log";

const SIGNAL_LINES =
  /^(Closing session|Opening session|Removing old closed session|Session already (closed|open)|Migrating session to|Closing open session in favor|Decrypted message with closed session|Failed to decrypt message with any known session|Session error:|V1 session storage migration error|WARNING: Expected pubkey|Unhandled bucket type)/;

/** Frames of these packages mean the call came from the Signal stack. */
const SIGNAL_ORIGIN = /[/\\]node_modules[/\\](?:\.pnpm[/\\][^/\\]*[/\\]node_modules[/\\])?(?:libsignal|@whiskeysockets[/\\]libsignal-node|baileys|whatsapp-rust-bridge)[/\\@]/i;

/** The worker's own structured line (log.ts), which is content free by rule. */
const OWN_LINE = '{"t":';

const HEX_RUN = /\b[0-9a-f]{32,}\b/gi;
const BASE64_RUN = /[A-Za-z0-9+/_-]{40,}={0,2}/g;

/** Blanks anything shaped like key material: long hex, long base64, raw bytes. */
export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(HEX_RUN, "[redacted]").replace(BASE64_RUN, "[redacted]");
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return "[bytes]";
  if (value && typeof value === "object" && !(value instanceof Error)) return "[object]";
  return value;
}

export type Decision = "pass" | "drop" | "decrypt-failed";

/** What to do with one console call, given its arguments and the stack that made it. */
export function decide(args: readonly unknown[], stack: string): Decision {
  const first = args[0];
  if (typeof first === "string" && first.startsWith(OWN_LINE)) return "pass";
  if (typeof first === "string" && SIGNAL_LINES.test(first)) return first.startsWith("Failed to decrypt") ? "decrypt-failed" : "drop";
  if (SIGNAL_ORIGIN.test(stack)) return "drop";
  return "pass";
}

let installed = false;

export function quietSignalLogs() {
  if (installed) return;
  installed = true;
  for (const level of ["info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const own = typeof args[0] === "string" && args[0].startsWith(OWN_LINE);
      const decision = own ? "pass" : decide(args, new Error().stack ?? "");
      if (decision === "decrypt-failed") log.warn("whatsapp message could not be decrypted");
      if (decision !== "pass") return;
      original(...(own ? args : args.map(redact)));
    };
  }
}
