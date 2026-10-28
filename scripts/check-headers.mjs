// Fails when a source file has no header comment (docs/CONVENTIONS.md, "File header"). Run by `pnpm lint`.
// TypeScript and TSX files need a leading `//` or `/*` comment (after any "use client" or "use server" directive);
// Python files need a leading docstring or `#` comment. Generated and stock files are skipped.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SKIP = [/database\.types\.ts$/, /(^|\/)components\/ui\//, /\.d\.ts$/, /(^|\/)__init__\.py$/, /(^|\/)next-env\.d\.ts$/];
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "apps", "packages"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(tsx?|py)$/.test(f) && !SKIP.some((re) => re.test(f)));

/** Whether the file starts with a header comment. */
function hasHeader(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return true; // deleted in the working tree
  }
  if (file.endsWith(".py")) {
    const head = text.trimStart();
    return head.startsWith('"""') || head.startsWith("'''") || head.startsWith("#");
  }
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && [`"use client";`, `"use server";`, ""].includes(lines[i].trim())) i++;
  const first = lines[i] ?? "";
  return /^\s*(\/\/|\/\*)/.test(first) && !/^\s*\/\/\s*(@ts-|eslint|biome|prettier)/.test(first);
}

const missing = files.filter((f) => !hasHeader(f));
if (missing.length > 0) {
  console.error(`${missing.length} file(s) have no header comment (see docs/CONVENTIONS.md):`);
  for (const f of missing) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`Header check: ${files.length} files ok.`);
