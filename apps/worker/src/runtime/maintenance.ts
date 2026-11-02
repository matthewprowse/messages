// Slow clean-up of stored files and old bulk mail, started on the primary shard. Both jobs need their migration and
// log until it is applied.

import { startEvery } from "../backoff";
import { errorCode, log } from "../log";
import { shrinkOldBulk } from "../ingest/shrink-bulk";
import { backfillThumbnails } from "../missing-files";

const THUMBNAIL_BACKFILL_MS = 5 * 60_000; // sealed 256 px thumbnails for photos stored before they were made
const SHRINK_BULK_MS = 60 * 60_000; // bulk mail older than 30 days cut to a preview

/**
 * Slow clean-up of what is stored, on shard 0: thumbnails for old photos (20 a pass, newest first) and old bulk mail
 * shortened to a preview (50 an hour). Both need their migration, and log until it is applied.
 */
export function startStorageMaintenance() {
  // startEvery never overlaps two runs of a job, so a slow pass cannot pile up behind itself.
  startEvery(THUMBNAIL_BACKFILL_MS, THUMBNAIL_BACKFILL_MS, () => backfillThumbnails(20), (err) => log.error("thumbnail backfill failed", { code: errorCode(err) }));
  startEvery(SHRINK_BULK_MS, SHRINK_BULK_MS, () => shrinkOldBulk(50), (err) => log.error("shrink bulk mail failed", { code: errorCode(err) }));
}
