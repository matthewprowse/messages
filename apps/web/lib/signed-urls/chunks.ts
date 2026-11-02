// Pure byte helpers for reading a download in pieces: the first bytes (to see whether the file is sealed before
// pulling the rest) and the pieces joined into one buffer. No network.

/** The first `size` bytes of the pieces (fewer if there are fewer), as one array. */
export function headOf(chunks: Uint8Array<ArrayBuffer>[], length: number, size: number): Uint8Array<ArrayBuffer> {
  const head = new Uint8Array(Math.min(length, size));
  let at = 0;
  for (const c of chunks) {
    if (at >= head.length) break;
    head.set(c.subarray(0, head.length - at), at);
    at += c.length;
  }
  return head;
}

/** The pieces joined end to end; length is their total size. */
export function joinChunks(chunks: Uint8Array<ArrayBuffer>[], length: number): Uint8Array<ArrayBuffer> {
  const all = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return all;
}
