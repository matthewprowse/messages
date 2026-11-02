// Runs async jobs a few at a time. A first sync can announce a thousand conversations at once; one request each, all
// together, would flood the browser's connections and the database.

/** Runs every job, at most limit at once. A job that throws does not stop the others; its error is swallowed here, so jobs handle their own. */
export async function runPooled(jobs: readonly (() => Promise<unknown> | unknown)[], limit: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try { await job(); } catch { /* the job reports its own failure */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), jobs.length) }, worker));
}
