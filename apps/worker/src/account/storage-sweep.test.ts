// storage-sweep.ts: the folder walk pages and recurses, removal is batched, and emptying a folder leaves nothing behind.

import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyFolder, listObjects, type StorageEntry, type StorageLister } from "./storage-sweep";

/** A fake bucket holding file paths; folders are derived from them like Supabase does. */
function fake(files: string[]): StorageLister & { files: Set<string>; removals: number[] } {
  const set = new Set(files);
  const removals: number[] = [];
  return {
    files: set,
    removals,
    async list(_bucket, folder, offset, pageSize) {
      const seen = new Map<string, StorageEntry>();
      for (const f of [...set].sort()) {
        if (!f.startsWith(`${folder}/`)) continue;
        const [head, ...rest] = f.slice(folder.length + 1).split("/");
        seen.set(head, { name: head, isFolder: rest.length > 0 });
      }
      return [...seen.values()].slice(offset, offset + pageSize);
    },
    async remove(_bucket, paths) {
      removals.push(paths.length);
      for (const p of paths) set.delete(p);
    },
  };
}

test("listObjects walks folders and reads every page", async () => {
  const files = ["u/a/1", "u/a/2", "u/b/c/3", ...Array.from({ length: 250 }, (_, i) => `u/f${String(i).padStart(3, "0")}`)];
  const found = await listObjects(fake(files), "attachments", "u");
  assert.equal(found.length, files.length);
  assert.ok(found.includes("u/b/c/3"));
});

test("another person's folder is never listed", async () => {
  const found = await listObjects(fake(["u/a", "uu/b", "other/c"]), "attachments", "u");
  assert.deepEqual(found, ["u/a"]);
});

test("emptyFolder deletes in batches of 100 and leaves the folder empty", async () => {
  const lister = fake(Array.from({ length: 230 }, (_, i) => `u/m/${i}`).concat(["keep/x"]));
  const count = await emptyFolder(lister, "attachments", "u");
  assert.equal(count, 230);
  assert.deepEqual(lister.removals, [100, 100, 30]);
  assert.deepEqual([...lister.files], ["keep/x"]);
});

test("an empty folder costs one listing and no delete", async () => {
  const lister = fake([]);
  assert.equal(await emptyFolder(lister, "avatars", "u"), 0);
  assert.deepEqual(lister.removals, []);
});

test("a tree deeper than any real path throws instead of looping", async () => {
  const deep: StorageLister = { list: async () => [{ name: "d", isFolder: true }], remove: async () => undefined };
  await assert.rejects(listObjects(deep, "attachments", "u"), { code: "STORAGE_DEPTH" });
});
