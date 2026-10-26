// Pure rules for files sent with an outbox row. No I/O, so it can be unit tested. The app checks the
// same limits before uploading; the worker checks again because the app can be bypassed.

const MB = 1024 * 1024;

/** Most files one message can carry, on every provider. */
export const MAX_ATTACHMENTS = 10;

/** How large the files of one message can be. Email limits are for all files together; WhatsApp's is per file. */
export const ATTACHMENT_LIMITS = {
  icloud: { totalBytes: 20 * MB, label: "iCloud Mail", size: "20 MB" },
  gmail: { totalBytes: 25 * MB, label: "Gmail", size: "25 MB" },
  // Exchange Online takes up to 35 MB with encoding by default, Outlook.com about 20 MB of files.
  outlook: { totalBytes: 20 * MB, label: "Outlook", size: "20 MB" },
  // WhatsApp takes 100 MB, but files reach the worker through Supabase Storage, whose Free plan uploads
  // at most 50 MB. Raise this with the plan's upload limit.
  whatsapp: { fileBytes: 50 * MB, label: "WhatsApp", size: "50 MB" },
  // Any other mailbox: each host sets its own limit, and 20 MB of files fits the common ones.
  imap: { totalBytes: 20 * MB, label: "Your mail server", size: "20 MB" },
} as const;

export type AttachmentProvider = keyof typeof ATTACHMENT_LIMITS;

/** How long the worker waits for the app to finish adding a row's files before failing it. */
export const ATTACHMENT_WAIT_MS = 60_000;

export const NOT_UPLOADED = "The attachments did not finish uploading. Try again.";
export const ATTACHMENTS_CHANGED = "The attachments changed while sending. Try again.";
export const ATTACHMENTS_MISSING = "An attachment could not be found. Try again.";
export const TOO_MANY = `You can send up to ${MAX_ATTACHMENTS} attachments at once.`;

/**
 * About how large these files make an email. Providers measure the whole message, and base64 makes each
 * file a third larger, plus line breaks and part headers; the allowance covers the headers and text.
 * The app uses the same estimate (apps/web/lib/outbox-files.ts).
 */
export function encodedEmailBytes(sizes: number[]): number {
  return sizes.reduce((sum, n) => sum + Math.ceil(Math.ceil(n / 3) * 4 * (78 / 76)) + 1024, 64 * 1024);
}

/** The reason to fail a message whose files are over the provider's limit, or null when they fit. */
export function limitError(provider: AttachmentProvider, sizes: number[]): string | null {
  if (sizes.length > MAX_ATTACHMENTS) return TOO_MANY;
  const limit = ATTACHMENT_LIMITS[provider];
  if ("totalBytes" in limit) {
    if (sizes.length > 0 && encodedEmailBytes(sizes) > limit.totalBytes) {
      return `${limit.label} allows up to ${limit.size} per email. Attachments grow by about a third when sent.`;
    }
  } else if (sizes.some((n) => n > limit.fileBytes)) {
    return `Each attachment can be up to ${limit.size} on ${limit.label}.`;
  }
  return null;
}

/**
 * Where the app is with a row's files: all there, still arriving, or wrong. The app adds the rows
 * after the outbox row, so fewer than expected means wait; more than expected is never right.
 */
export function attachmentProgress(expected: number, found: number): "ready" | "waiting" | "too_many" {
  if (found > expected) return "too_many";
  return found === expected ? "ready" : "waiting";
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * True when a stored file is exactly "<user id>/outbox/<uuid>/<safe name>", the format the app writes.
 * Nothing else is accepted: the worker downloads these paths with the service role, so a "%", a "..",
 * or an extra folder must never get through. The insert policy on outbox_attachments checks the same.
 */
export function ownOutboxPath(userId: string, path: string): boolean {
  if (!new RegExp(`^${UUID}$`).test(userId)) return false;
  return new RegExp(`^${userId}/outbox/${UUID}/[A-Za-z0-9()][A-Za-z0-9._() -]{0,99}$`).test(path);
}

/** The path as it goes in a storage URL, each folder and the name encoded. */
export function storageUrlPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/** The type to label an attached file with. Anything malformed goes as a plain download. */
export function safeMimeType(mimeType: string): string {
  const type = mimeType.trim().toLowerCase();
  return MIME_TYPE.test(type) ? type : "application/octet-stream";
}

/** One line, no path separators or control characters, never empty. */
export function safeFilename(filename: string): string {
  const name = filename.replace(/[\u0000-\u001f\u007f/\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 255);
  return name || "attachment";
}
