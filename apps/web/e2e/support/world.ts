// The ids the seed made, so a test can find a conversation by the short key it has in fake-data.ts and fake-chats.ts. Global
// setup writes them to e2e/.cache/world.json (ids only, nothing readable; the folder ignores itself) and the tests read them
// back, because global setup and the test workers are different processes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WEB_DIR } from "./test-env";
import type { ProjectName } from "./users";

/** One project's user and what was made for them. */
export interface World {
  userId: string;
  accountId: string;
  whatsappAccountId: string;
  /** Conversation ids by key: the email ones (fake-data.ts) and the WhatsApp ones (fake-chats.ts). */
  threads: Record<string, string>;
  /** Message ids in order, by conversation key. */
  messages: Record<string, string[]>;
  /** The first Message-ID of each email conversation, which its later messages refer to. */
  roots: Record<string, string>;
}

const DIR = path.join(WEB_DIR, "e2e/.cache");
const FILE = path.join(DIR, "world.json");

/** Saves every project's world. The folder gets a .gitignore of its own so the file can never be committed. */
export function writeWorlds(worlds: Record<ProjectName, World>) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, ".gitignore"), "*\n");
  writeFileSync(FILE, JSON.stringify(worlds));
}

let cached: Record<string, World> | null = null;

/** A project's world. Throws when global setup has not run. */
export function worldOf(project: ProjectName): World {
  if (!cached) {
    if (!existsSync(FILE)) throw new Error("The seed has not run: e2e/.cache/world.json is missing.");
    cached = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, World>;
  }
  const found = cached[project];
  if (!found) throw new Error(`The seed made nothing for ${project}.`);
  return found;
}

/** The id of a conversation by its key. Throws on an unknown key. */
export function threadOf(project: ProjectName, key: string): string {
  const id = worldOf(project).threads[key];
  if (!id) throw new Error(`The seed made no conversation named ${key}.`);
  return id;
}
