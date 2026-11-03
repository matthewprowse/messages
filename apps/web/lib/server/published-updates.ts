// The public Updates page's data: published changelog entries only, read on the server with the service role (the
// database's read policies are for signed-in people) and cached for five minutes, so a visit does not ask the database.
// Only the (marketing)/updates server component imports this; it never reaches the browser.

import { unstable_cache } from "next/cache";
import { READER_COLUMNS, mapReaderUpdate, sortReleases, type ReaderUpdate } from "@/lib/updates-seen";
import { admin } from "./request";

// Plenty for a changelog; the page is not paged yet.
const LIMIT = 200;

/** Every published release, newest release date first, then the higher version on the same day. */
export const loadPublicUpdates = unstable_cache(
  async (): Promise<ReaderUpdate[]> => {
    if (!admin) return [];
    const { data, error } = await admin.from("updates").select(READER_COLUMNS).eq("published", true).limit(LIMIT);
    if (error) throw error;
    return sortReleases((data ?? []).map(mapReaderUpdate));
  },
  ["public-updates"],
  { revalidate: 300 },
);
