// The in-memory store of opened photo thumbnails (signed-urls.ts openThumb): a bounded least-recently-used map of blob links
// by attachment id. Memory only; nothing decrypted is ever persisted.

/** Opened thumbnails kept at once. Each is a small decrypted blob, about 15 KB. */
export const THUMB_CACHE_MAX = 300;

/** A bounded least-recently-used map of blob links, which revokes a link when it is pushed out. */
export class ThumbCache {
  private readonly links = new Map<string, string>();
  constructor(private readonly max = THUMB_CACHE_MAX, private readonly revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)) {}

  get(id: string): string | undefined {
    const url = this.links.get(id);
    if (url === undefined) return undefined;
    this.links.delete(id); // most recently used goes last
    this.links.set(id, url);
    return url;
  }

  set(id: string, url: string) {
    const old = this.links.get(id);
    if (old !== undefined && old !== url) this.revoke(old);
    this.links.delete(id);
    this.links.set(id, url);
    while (this.links.size > this.max) {
      const [oldest, link] = this.links.entries().next().value as [string, string];
      this.links.delete(oldest);
      this.revoke(link);
    }
  }

  /** Revokes and forgets every link, for when the person signs out. */
  clear() {
    for (const link of this.links.values()) this.revoke(link);
    this.links.clear();
  }

  get size() {
    return this.links.size;
  }
}
