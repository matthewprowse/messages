// The content type of an opened attachment, worked out from its name and kind: a sealed upload does not keep one.

const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  avif: "image/avif", bmp: "image/bmp", pdf: "application/pdf", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", txt: "text/plain",
};
const KIND_TYPES: Record<string, string> = { image: "image/jpeg", pdf: "application/pdf", video: "video/mp4", audio: "audio/ogg" };

/** The content type to give an opened attachment's blob, from its name (the sealed upload does not keep one). */
export function mimeFor(file: { name: string; kind: string }): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase();
  return (ext && EXTENSION_TYPES[ext]) || KIND_TYPES[file.kind] || "application/octet-stream";
}
