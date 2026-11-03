// The public Updates page's data: published changelog entries only, read on the server with the service role (the
// database's read policies are for signed-in people) and cached for five minutes, so a visit does not ask the database.
// Only the (marketing)/updates server component imports this; it never reaches the browser.

import { unstable_cache } from "next/cache";
import { READER_COLUMNS, mapReaderUpdate, sortPublished, type ReaderUpdate } from "@/lib/updates-seen";
import { admin } from "./request";

// Plenty for a changelog; the page is not paged yet.
const LIMIT = 200;

/** Every published release, by release date, newest first; on the same day the one published last comes first. */
export const loadPublicUpdates = unstable_cache(
  async (): Promise<ReaderUpdate[]> => {
    if (!admin) return [];
    const { data, error } = await admin.from("updates").select(READER_COLUMNS).eq("published", true).limit(LIMIT);
    if (error) throw error;
    // sortPublished orders by when each went public; the stable sort then groups by release date, which a reader expects.
    return sortPublished((data ?? []).map(mapReaderUpdate)).sort((a, b) => b.releasedOn.localeCompare(a.releasedOn));
  },
  ["public-updates"],
  { revalidate: 300 },
);
