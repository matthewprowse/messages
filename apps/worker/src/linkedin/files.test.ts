// Tests for linkedin/files.ts: how files map to the helper's kinds, that staging is private and cleaned up,
// and that more files get a longer send timeout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { helperKind, sendTimeoutMs, stageFiles } from "./files";

test("photos and MP4 videos go as such, the rest as documents", () => {
  assert.equal(helperKind("image/jpeg"), "image");
  assert.equal(helperKind("IMAGE/PNG"), "image");
  assert.equal(helperKind("image/heic"), "file");
  assert.equal(helperKind("image/svg+xml"), "file");
  assert.equal(helperKind("video/mp4"), "video");
  assert.equal(helperKind("video/quicktime"), "file");
  assert.equal(helperKind("application/pdf"), "file");
});

test("files are staged privately, by position, and removed again", async () => {
  const base = await mkdtemp(join(tmpdir(), "stage-test-"));
  try {
    const staged = await stageFiles(
      [
        { filename: "../../evil.png", contentType: "image/png", content: Buffer.from("PNG") },
        { filename: "Plan.pdf", contentType: "application/pdf", content: Buffer.from("PDF") },
      ],
      base,
    );
    const dir = join(staged.files[0].path, "..");
    assert.ok(dir.startsWith(base));
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal((await stat(staged.files[0].path)).mode & 0o777, 0o600);
    assert.equal(await readFile(staged.files[1].path, "utf8"), "PDF");
    assert.deepEqual(staged.files.map((f) => [f.name, f.mime, f.kind]), [["../../evil.png", "image/png", "image"], ["Plan.pdf", "application/pdf", "file"]]);
    assert.ok(staged.files.every((f) => f.path.startsWith(dir + "/")));
    await staged.cleanup();
    await assert.rejects(stat(dir));
    await staged.cleanup(); // twice is fine
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("more files get more time", () => {
  assert.ok(sendTimeoutMs(5) > sendTimeoutMs(1));
  assert.ok(sendTimeoutMs(0) >= 90_000);
});
