// The session's opened sealed thumbnails, by attachment id. Memory only: nothing decrypted is ever written to
// IndexedDB, localStorage or sessionStorage. A module of its own so links.ts can clear it on sign out and
// sealed-files.ts can fill it without importing each other.

import { ThumbCache } from "../thumb-cache";

export const thumbCache = new ThumbCache();
