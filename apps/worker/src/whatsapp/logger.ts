// Baileys logs decrypted messages, phone numbers and keys at its debug levels, so its own logging is
// off except for one kind of line: the fixed status messages of app state sync (contacts, names and
// chat settings), which say only which collection and version. Any line with an "@" or a long number
// in it is dropped as well, in case one ever carries a JID.
// One trace line is caught as well, never logged: app state sync traces each change it applies, and that is the only place a
// call log record reaches us (Baileys reads none of them). linkLogger hands those records to the connector (calls.ts).

import type { ILogger } from "baileys/lib/Utils/logger";
import type { proto } from "baileys";
import { log } from "../log";
import { callLogRecordOf } from "./calls";

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

/** The silent logger for one link, which also passes on each call log record app state sync applies. */
export function linkLogger(onCallLog: (record: proto.ICallLogRecord) => void): ILogger {
  const logger: ILogger = {
    ...silentLogger,
    child: () => logger,
    trace: (a: unknown, b?: unknown) => {
      if (b !== "processing sync action") return;
      const record = callLogRecordOf(a);
      if (record) onCallLog(record);
    },
  };
  return logger;
}
