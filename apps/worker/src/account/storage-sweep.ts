// Finds and removes every object under a folder of a storage bucket. Pure: the storage calls come in through StorageLister, so
// the walk and the batching are tested without Supabase. Used to empty a person's "<user id>/" folder on Delete My Account.

/** One entry of a folder listing. Supabase marks a folder by giving it no id. */
export interface StorageEntry { name: string; isFolder: boolean }

/** The two storage calls the sweep needs (the worker's version is in jobs.ts; the tests use a fake). */
export interface StorageLister {
  /** One page of a folder, from `offset`. A page shorter than `pageSize` is the last. */
  list(bucket: string, folder: string, offset: number, pageSize: number): Promise<StorageEntry[]>;
  /** Deletes objects. Succeeds when one is already gone. */
  remove(bucket: string, paths: string[]): Promise<void>;
}

const PAGE = 100; // entries per listing page
const REMOVE_BATCH = 100; // objects per delete call
const MAX_DEPTH = 8; // folders below the user's own; the deepest real path is <user>/<message>/<file>

/** Every object path under `folder`, folders walked depth first. Throws if the tree is deeper than MAX_DEPTH (a loop, not data). */
export async function listObjects(lister: StorageLister, bucket: string, folder: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) throw Object.assign(new Error("storage tree too deep"), { code: "STORAGE_DEPTH" });
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await lister.list(bucket, folder, offset, PAGE);
    for (const entry of page) {
      const path = `${folder}/${entry.name}`;
      if (entry.isFolder) out.push(...(await listObjects(lister, bucket, path, depth + 1)));
      else out.push(path);
    }
    if (page.length < PAGE) return out;
  }
}

/** Deletes the paths in batches and returns how many were asked for. */
export async function removeObjects(lister: StorageLister, bucket: string, paths: string[]): Promise<number> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) await lister.remove(bucket, paths.slice(i, i + REMOVE_BATCH));
  return paths.length;
}

/** Empties a folder: lists it, deletes what it finds, and lists again so an object that arrived meanwhile goes too. Returns the count deleted. */
export async function emptyFolder(lister: StorageLister, bucket: string, folder: string): Promise<number> {
  let total = 0;
  for (let pass = 0; pass < 3; pass++) {
    const paths = await listObjects(lister, bucket, folder);
    if (paths.length === 0) return total;
    total += await removeObjects(lister, bucket, paths);
  }
  return total;
}
