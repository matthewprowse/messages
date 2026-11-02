// The search Web Worker: holds the index and answers requests from the page (see host.ts). It keeps decrypted text out of
// the page's memory and keeps searching off the thread that draws the screen. Started by client.ts.

import { createHost } from "./host";
import type { Envelope } from "./protocol";
import { hasIndexedDb, idbStorage } from "./idb-storage";
import { memoryStorage } from "./sealed-store";

const scope = self as unknown as { postMessage(message: unknown): void; onmessage: ((event: MessageEvent<Envelope>) => void) | null };

// One storage for the worker's life; without IndexedDB the index simply lives in memory for this tab.
const storage = hasIndexedDb() ? idbStorage() : memoryStorage();
const host = createHost(() => storage, (reply) => scope.postMessage(reply));
scope.onmessage = (event) => host.handle(event.data);
