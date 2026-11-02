// The worker's one Flags reader, bound to the database. Import `flags` from here at the choke points: the outbox claim
// (send/outbox.ts) and the connector start (runtime/reconcile.ts).

import { db } from "./db";
import { log } from "./log";
import { Flags } from "./flags";

let warned = false;

export const flags = new Flags(
  async () => {
    const { data, error } = await db.from("feature_flags").select("key, enabled, user_ids");
    if (error) throw Object.assign(new Error("read feature flags failed"), { code: error.code ?? "FLAGS_READ_FAILED" });
    return data;
  },
  {
    onError: (code) => {
      // Once is enough: the table may simply not be migrated yet, and the worker runs with every switch off meanwhile.
      if (!warned) log.warn("feature flags not read, all switches off until they are", { code });
      warned = true;
    },
  },
);
