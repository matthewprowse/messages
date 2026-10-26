// WAV files as the daily brief's audio parts come: 16-bit PCM written by the AI worker.

/** The audio samples of a WAV file and the format chunk that describes them, or null if it is not one. */
function wavData(bytes: Uint8Array<ArrayBuffer>): { fmt: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer> } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let fmt: Uint8Array<ArrayBuffer> | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true);
    const body = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size));
    if (tag(at) === "fmt ") fmt = body;
    else if (tag(at) === "data") return fmt ? { fmt, data: body } : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

/**
 * The brief's parts as one WAV, so a brief already fully stored plays as one recording with no break
 * between parts. Null when they are not all WAV files of the same format.
 */
export async function joinParts(parts: Blob[]): Promise<Blob | null> {
  const read = (await Promise.all(parts.map(async (p) => wavData(new Uint8Array(await p.arrayBuffer()))))).filter((p) => p !== null);
  if (read.length === 0 || read.length !== parts.length) return null;
  const fmt = read[0].fmt;
  if (read.some((p) => p.fmt.length !== fmt.length || p.fmt.some((b, i) => b !== fmt[i]))) return null;
  const length = read.reduce((n, p) => n + p.data.length, 0);
  const header = new DataView(new ArrayBuffer(20 + fmt.length + 8));
  const ascii = (at: number, s: string) => { for (let i = 0; i < 4; i++) header.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, "RIFF");
  header.setUint32(4, 4 + 8 + fmt.length + 8 + length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  header.setUint32(16, fmt.length, true);
  new Uint8Array(header.buffer).set(fmt, 20);
  ascii(20 + fmt.length, "data");
  header.setUint32(24 + fmt.length, length, true);
  return new Blob([header.buffer, ...read.map((p) => p.data)], { type: "audio/wav" });
}
