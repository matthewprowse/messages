import { log } from "../log";

// libsignal, which Baileys uses for end-to-end encryption, writes whole Signal sessions to the console
// ("Closing session: SessionEntry {...}"), private keys included. Those lines are dropped here, by
// their exact wording, and failures to decrypt are counted instead. Everything else reaches the
// console as before; the worker's own logs are JSON lines and never match.

const SIGNAL_LINES =
  /^(Closing session|Opening session|Removing old closed session|Session already (closed|open)|Migrating session to|Closing open session in favor|Decrypted message with closed session|Failed to decrypt message with any known session|Session error:|V1 session storage migration error|WARNING: Expected pubkey|Unhandled bucket type)/;

let installed = false;

export function quietSignalLogs() {
  if (installed) return;
  installed = true;
  for (const level of ["info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      if (typeof args[0] === "string" && SIGNAL_LINES.test(args[0])) {
        if (args[0].startsWith("Failed to decrypt")) log.warn("whatsapp message could not be decrypted");
        return;
      }
      original(...args);
    };
  }
}
