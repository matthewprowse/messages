// Fails when the installed Baileys, libsignal or WhatsApp WASM bridge differs from scripts/baileys-lock.json.
// The bridge ships its WASM inside dist/index.js, so that file's sha256 stands for the WASM. A hijacked or
// unreviewed release changes the hash and CI fails loudly. Update the JSON only after reading the diff
// (apps/worker/README.md, "Updating Baileys"). Run by CI after install: `node scripts/check-baileys.mjs`.

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Problems found, comparing what is installed with the lock; empty when all match. */
export function compare(lock, installed) {
  const problems = [];
  if (installed.baileys !== lock.baileys) problems.push(`baileys is ${installed.baileys}, lock says ${lock.baileys}`);
  if (installed.libsignal !== lock.libsignal) problems.push(`libsignal is ${installed.libsignal}, lock says ${lock.libsignal}`);
  const bridge = lock["whatsapp-rust-bridge"];
  if (installed.bridge.version !== bridge.version) problems.push(`whatsapp-rust-bridge is ${installed.bridge.version}, lock says ${bridge.version}`);
  for (const [file, sha] of Object.entries(bridge.files)) {
    if (installed.bridge.files[file] !== sha) problems.push(`whatsapp-rust-bridge ${file} sha256 is ${installed.bridge.files[file]}, lock says ${sha}`);
  }
  return problems;
}

/** Where a dependency is installed. pnpm lays out a package's own dependencies as siblings of its real directory, so this reads the same files the worker loads (package.json is not in the exports map, so it cannot be resolved). */
const sibling = (dir, name) => join(dirname(realpathSync(dir)), name);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const lock = readJson(join(root, "scripts/baileys-lock.json"));
  const baileysDir = join(root, "apps/worker/node_modules/baileys");
  const baileysPkg = join(baileysDir, "package.json");
  const bridgeDir = sibling(baileysDir, "whatsapp-rust-bridge");
  const installed = {
    baileys: readJson(baileysPkg).version,
    libsignal: readJson(join(sibling(baileysDir, "libsignal"), "package.json")).version,
    bridge: { version: readJson(join(bridgeDir, "package.json")).version, files: {} },
  };
  for (const file of Object.keys(lock["whatsapp-rust-bridge"].files)) installed.bridge.files[file] = sha256(join(bridgeDir, file));
  const problems = compare(lock, installed);
  if (problems.length) {
    console.error("BAILEYS CHECK FAILED. The installed WhatsApp library does not match scripts/baileys-lock.json:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error('If you updated it on purpose, follow "Updating Baileys" in apps/worker/README.md. If not, do not deploy.');
    process.exit(1);
  }
  console.log(`baileys ${installed.baileys}, libsignal ${installed.libsignal}, whatsapp-rust-bridge ${installed.bridge.version}: match the lock`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
