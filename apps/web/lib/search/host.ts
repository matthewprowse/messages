// What runs behind the search worker's message port: the engine plus its encrypted storage, answering requests one at a
// time. It takes the storage and a reply function as parameters, so the worker, the main-thread fallback and the tests
// all use it unchanged and no test needs a browser.

import { SearchEngine } from "./engine";
import { SealedStore, type ByteStorage } from "./sealed-store";
import type { Counts, Envelope, InitReply, Reply, Request } from "./protocol";

/** Changes are written this long after the last one (ms), but never later than MAX_WAIT_MS after the first, so a long build still saves as it goes. */
const SAVE_DELAY_MS = 2000;
const MAX_WAIT_MS = 15_000;

export function createHost(openStorage: () => ByteStorage, reply: (r: Reply) => void) {
  let engine = new SearchEngine();
  let store: SealedStore | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstDirty = 0;

  const counts = (): Counts => ({ docs: engine.size, messages: engine.count("message"), files: engine.count("file") });

  async function save() {
    clearTimeout(timer);
    timer = undefined;
    firstDirty = 0;
    if (!store?.pending) return;
    try {
      await store.flush((id) => engine.get(id));
    } catch {
      // The store keeps the shards marked, so the next change or flush tries again. Search itself does not need the disk.
    }
  }

  function scheduleSave() {
    const now = Date.now();
    if (!firstDirty) firstDirty = now;
    clearTimeout(timer);
    timer = setTimeout(() => void save(), Math.max(0, Math.min(SAVE_DELAY_MS, firstDirty + MAX_WAIT_MS - now)));
    // A pending save must not keep a Node process (the tests) alive; in a browser this does nothing.
    (timer as { unref?: () => void }).unref?.();
  }

  async function run(req: Request): Promise<unknown> {
    switch (req.t) {
      case "init": {
        engine = new SearchEngine();
        store = new SealedStore(openStorage(), req.keys, req.userId);
        const loaded = await store.load();
        const dropped = engine.upsert(loaded.docs);
        if (dropped.length) { store.markRemoved(dropped); scheduleSave(); }
        return { counts: counts(), rebuilt: loaded.rebuilt, meta: loaded.meta } satisfies InitReply;
      }
      case "upsert": {
        const dropped = engine.upsert(req.docs);
        store?.markUpserted(req.docs.map((d) => d.id));
        if (dropped.length) store?.markRemoved(dropped);
        scheduleSave();
        return counts();
      }
      case "remove":
        engine.remove(req.ids);
        store?.markRemoved(req.ids);
        scheduleSave();
        return counts();
      case "removeMessages": {
        const ids = engine.removeMessages(req.refs);
        store?.markRemoved(ids);
        scheduleSave();
        return counts();
      }
      case "search":
        return engine.search(req.q, req.limits);
      case "threads":
        return [...engine.threadIds(req.q, req.cap)];
      case "known":
        return req.ids.filter((id) => engine.has(id));
      case "stamps":
        return engine.stamps(req.kind);
      case "meta":
        store?.setMeta(req.data);
        scheduleSave();
        return null;
      case "flush":
        await save();
        return null;
      case "clear":
        clearTimeout(timer);
        timer = undefined;
        engine = new SearchEngine();
        // Clearing needs no key, so it also works before init (a sign-out seen by a page that never opened the index).
        await (store ? store.clear() : openStorage().clear());
        return null;
    }
  }

  // One request at a time, in the order sent: an upsert is always in the index before the search that follows it.
  let queue: Promise<void> = Promise.resolve();
  return {
    handle(env: Envelope) {
      queue = queue.then(async () => {
        try {
          reply({ id: env.id, ok: true, value: await run(env.req) });
        } catch {
          reply({ id: env.id, ok: false });
        }
      });
    },
  };
}
