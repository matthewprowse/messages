// A Map that holds at most a set number of entries, dropping the least recently used one first. The WhatsApp
// connector keeps names, chats, groups and counters in memory for the life of the worker; without a bound they
// only ever grew. Everything kept this way can be worked out again (from the database or the socket), so an
// evicted entry costs one lookup, never a wrong answer.

export class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly max: number) {
    super();
  }

  /** Reading an entry makes it the most recently used. */
  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key) as V;
    super.delete(key);
    super.set(key, value);
    return value;
  }

  override set(key: K, value: V): this {
    super.delete(key);
    super.set(key, value);
    while (this.size > this.max) {
      const oldest = this.keys().next();
      if (oldest.done) break;
      super.delete(oldest.value);
    }
    return this;
  }
}
