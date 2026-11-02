// WhatsApp Web's current version, cached across reconnects (module level, shared by every account in this process).

import { fetchLatestWaWebVersion } from "baileys";

const VERSION_TTL_MS = 6 * 60 * 60_000;
let cachedVersion: { at: number; value: Awaited<ReturnType<typeof fetchLatestWaWebVersion>> } | null = null;

/** WhatsApp Web's current version, asked for at most every few hours. Null when it cannot be fetched. */
export async function latestWebVersion() {
  if (cachedVersion && Date.now() - cachedVersion.at < VERSION_TTL_MS) return cachedVersion.value;
  const value = await fetchLatestWaWebVersion().catch(() => null);
  if (value?.isLatest) cachedVersion = { at: Date.now(), value };
  return value;
}
