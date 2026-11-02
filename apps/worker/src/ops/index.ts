// What the entry point calls: error reporting, the metrics log line and the health endpoint in one start-up call.

import { log } from "../log";
import { initErrorReporting, reportError } from "./errors";
import { createHealth, healthPort, startHealthServer, type Health } from "./health";
import { startMetricsFlush } from "./metrics";

export { reportError } from "./errors";
export { countAiCall, countSend, countSync } from "./metrics";

/** Starts ops for the sync worker. The returned Health is ticked by the main loop and told about the lease. */
export function startOps(): Health {
  initErrorReporting("worker");
  startMetricsFlush();
  const health = createHealth();
  const port = healthPort(process.env.HEALTH_PORT);
  if (port) {
    startHealthServer(health, port).on("error", (err) => reportError(err, "health_server"));
    log.info("health endpoint listening", { port });
  }
  return health;
}
