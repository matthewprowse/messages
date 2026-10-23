import type { ILogger } from "baileys/lib/Utils/logger";
import { log } from "../log";

// Baileys logs decrypted messages, phone numbers and keys at its debug levels, so its own logging is
// off except for one kind of line: the fixed status messages of app state sync (contacts, names and
// chat settings), which say only which collection and version. Any line with an "@" or a long number
// in it is dropped as well, in case one ever carries a JID.
const SYNC_STATUS = /^(resyncing|synced|restored state of|\S+ has more patches|\S+ blocked on missing key|failed to sync|Doing app state sync|App state sync (complete|key arrived)|app state sync key arrived)/i;

function forward(level: "info" | "warn" | "error", a: unknown, b?: unknown) {
  const msg = typeof a === "string" ? a : typeof b === "string" ? b : null;
  if (!msg || !SYNC_STATUS.test(msg) || /@|\d{7,}/.test(msg)) return;
  log[level](`whatsapp sync: ${msg}`);
}

export const silentLogger: ILogger = {
  level: "info",
  child: () => silentLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: (a, b) => forward("info", a, b),
  warn: (a, b) => forward("warn", a, b),
  error: (a, b) => forward("error", a, b),
};
