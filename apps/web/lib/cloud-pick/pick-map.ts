// Turns what Google's Picker and the OneDrive File Picker hand back into one shape (CloudPick), says how to download each,
// and checks size limits before anything is downloaded. Pure: no network, no window. The pickers themselves are in
// google.ts and onedrive.ts; downloading is in download.ts.

import { displayName, limitError, mimeOf, type AttachProvider } from "../outbox-files";

export type CloudSource = "google" | "onedrive";

/** A file chosen in a cloud picker, not yet downloaded. */
export interface CloudPick {
  source: CloudSource;
  /** The name the file will have once attached (an exported Google document gets its extension). */
  name: string;
  /** Bytes as the provider reports them; null for Google documents, which have no size until exported. */
  size: number | null;
  mimeType: string;
  /** Where to fetch the bytes, with the same bearer token the picker was given. */
  url: string;
}

export const GOOGLE_FILES = "https://www.googleapis.com/drive/v3/files";
export const GRAPH_DRIVES = "https://graph.microsoft.com/v1.0/drives";
/** Google caps an export at 10 MB. */
export const GOOGLE_EXPORT_MAX_BYTES = 10 * 1024 * 1024;

/** What a Google-native document becomes when it is downloaded. */
const GOOGLE_EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  "application/vnd.google-apps.presentation": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx" },
  "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: "pdf" },
};

/** What Google's Picker returns for each chosen document (only the fields used). */
export interface GoogleDoc {
  id: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number | string;
}

/** A name with an extension added only when it does not already end in it. */
function withExtension(name: string, ext: string): string {
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

/** The pick for one Google Drive document, or a reason it cannot be attached (a folder, a form, a shortcut). */
export function mapGoogleDoc(doc: GoogleDoc): CloudPick | { error: string } {
  const type = doc.mimeType ?? "";
  const name = displayName(doc.name || "Google Drive File");
  if (type.startsWith("application/vnd.google-apps.")) {
    const out = GOOGLE_EXPORTS[type];
    if (!out) return { error: `${name} is a Google Drive item that cannot be attached as a file.` };
    return { source: "google", name: withExtension(name, out.ext), size: null, mimeType: out.mime, url: `${GOOGLE_FILES}/${encodeURIComponent(doc.id)}/export?mimeType=${encodeURIComponent(out.mime)}` };
  }
  const size = Number(doc.sizeBytes);
  return {
    source: "google",
    name,
    size: Number.isFinite(size) && size >= 0 && doc.sizeBytes !== undefined ? size : null,
    mimeType: mimeOf(name, type),
    url: `${GOOGLE_FILES}/${encodeURIComponent(doc.id)}?alt=media&supportsAllDrives=true`,
  };
}

/** What OneDrive's picker returns for each chosen item (only the fields used). */
export interface OneDriveItem {
  id: string;
  name?: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: unknown;
  parentReference?: { driveId?: string };
}

/** The pick for one OneDrive item, or a reason it cannot be attached. */
export function mapOneDriveItem(item: OneDriveItem): CloudPick | { error: string } {
  const name = displayName(item.name || "OneDrive File");
  const drive = item.parentReference?.driveId;
  if (item.folder || !drive) return { error: `${name} is a folder or an item that cannot be attached as a file.` };
  return {
    source: "onedrive",
    name,
    size: typeof item.size === "number" ? item.size : null,
    mimeType: mimeOf(name, item.file?.mimeType ?? ""),
    url: `${GRAPH_DRIVES}/${encodeURIComponent(drive)}/items/${encodeURIComponent(item.id)}/content`,
  };
}

/** Splits mapped results into the picks to download and the messages for the ones that cannot be. */
export function partitionPicks(results: (CloudPick | { error: string })[]): { picks: CloudPick[]; errors: string[] } {
  const picks: CloudPick[] = [];
  const errors: string[] = [];
  for (const r of results) ("error" in r ? errors.push(r.error) : picks.push(r));
  return { picks, errors };
}

/**
 * Whether these picks may be downloaded, before any byte moves: the same limits as a local file (OUTBOX_LIMITS for a
 * message, the per-file cap for a note), counting files already attached. Unknown sizes pass here and are checked on the
 * downloaded file. Returns the message to show, or null.
 */
export function precheckPicks(picks: CloudPick[], rule: { provider: AttachProvider; existing: { name: string; size: number }[] } | { maxBytes: number }): string | null {
  if (picks.length === 0) return null;
  if ("maxBytes" in rule) {
    const big = picks.find((p) => p.size !== null && p.size > rule.maxBytes);
    return big ? `${big.name} is over ${Math.round(rule.maxBytes / (1024 * 1024))} MB.` : null;
  }
  const known = picks.filter((p): p is CloudPick & { size: number } => p.size !== null).map((p) => ({ name: p.name, size: p.size }));
  const files = [...rule.existing, ...known];
  const empty = known.find((p) => p.size === 0);
  if (empty) return `${empty.name} is empty.`;
  return limitError(rule.provider, files);
}

/** Why a Google export that failed is likely to have: the 10 MB export cap shows as HTTP 403. */
export function downloadProblem(pick: Pick<CloudPick, "name" | "source">, status: number): string {
  if (status === 401) return `Sign in to ${pick.source === "google" ? "Google Drive" : "OneDrive"} again to attach ${pick.name}.`;
  if (status === 403 && pick.source === "google") return `${pick.name} could not be exported. Google allows exports up to 10 MB.`;
  if (status === 404) return `${pick.name} could not be found. It may have moved.`;
  return `${pick.name} did not download. Try again.`;
}

/**
 * Where OneDrive's picker is opened: personal accounts use onedrive.live.com, work and school accounts their own
 * SharePoint address, found from the drive's web link.
 */
export function oneDrivePickerBase(driveType: string | undefined, webUrl: string | undefined): string {
  if (driveType === "personal" || !webUrl) return "https://onedrive.live.com/picker";
  try {
    return `${new URL(webUrl).origin}/_layouts/15/FilePicker.aspx`;
  } catch {
    return "https://onedrive.live.com/picker";
  }
}
