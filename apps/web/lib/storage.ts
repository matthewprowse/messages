// Fair usage for stored attachments (docs/PLAN.md, Fair Usage and Storage). 20 GB a seat.
export const STORAGE_CAP_BYTES = 20 * 1024 ** 3;

export function bytesLabel(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export type StorageLevel = "ok" | "near" | "full";

/** Where storage stands: nothing shown under 80%, a notice from 80%, and new files stop being saved from 100%. */
export function storageLevel(heldBytes: number, capBytes: number): StorageLevel {
  const used = capBytes > 0 ? (heldBytes / capBytes) * 100 : 0;
  return used >= 100 ? "full" : used >= 80 ? "near" : "ok";
}
