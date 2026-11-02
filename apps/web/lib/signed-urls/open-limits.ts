// How big a sealed file the browser will open whole. A sealed file is one encrypted block, so it cannot be played or drawn
// as it arrives: the download, its decrypted copy and the Blob can coexist in memory (two to three times the file). An
// iPhone tab dies well before a desktop one does, so there the limit is lower and the viewer says so instead of crashing.
// Pure, so it is tested alone.

const MB = 1024 * 1024;

/** The most a phone or tablet with little memory opens whole. */
export const SMALL_DEVICE_OPEN_MAX = 20 * MB;
/** The most any device opens whole: it is also the most the worker stores (MAX_FILE_BYTES). */
export const OPEN_MAX = 50 * MB;

/** What the browser reports about itself that decides the limit. */
export type DeviceHints = { userAgent: string; /** navigator.maxTouchPoints; iPadOS says it is a Mac. */ touchPoints?: number; /** navigator.deviceMemory in GB, where the browser has it. */ memoryGb?: number };

/** True for an iPhone, iPad or iPod, including an iPad that presents itself as a Mac. */
export function isAppleTouchDevice({ userAgent, touchPoints = 0 }: DeviceHints): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
}

/** The largest sealed file, in bytes, this device opens whole. */
export function sealedOpenLimit(hints: DeviceHints): number {
  return isAppleTouchDevice(hints) || (hints.memoryGb !== undefined && hints.memoryGb <= 2) ? SMALL_DEVICE_OPEN_MAX : OPEN_MAX;
}

/** This browser's limit. */
export function currentOpenLimit(): number {
  if (typeof navigator === "undefined") return OPEN_MAX;
  return sealedOpenLimit({ userAgent: navigator.userAgent, touchPoints: navigator.maxTouchPoints, memoryGb: (navigator as { deviceMemory?: number }).deviceMemory });
}

/** True when a download of this many bytes (its Content-Length) is too big to open here. An unknown size is let through. */
export const exceedsOpenLimit = (bytes: number | null, limit: number) => bytes !== null && Number.isFinite(bytes) && bytes > limit;
