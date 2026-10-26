import { addressIndex } from "@messages/crypto/addresses";
import type { TablesInsert } from "@messages/db";
import { db, must } from "../src/db";
import { keysFor, sealAddress } from "../src/vault";

// The Messages user an account belongs to, found by the email you sign in to the app with, the
// account row the setup scripts save, and the terminal prompt they use, hidden for passwords.

/**
 * Saves the user's account for this provider and address, and returns its id. A stored address may be
 * encrypted, which an upsert on the address never matches, so connecting again would add a second
 * account. An existing one is found by its blind index instead (or by the plain address, for a row the
 * indexer has not reached yet) and updated; a new one is stored with its address sealed and indexed.
 * onePerUser: a provider you have one of (iCloud Calendar), so signing in with another address takes over
 * the account you have rather than adding a second that shows every event again.
 */
export async function saveAccountRow(
  userId: string,
  provider: TablesInsert<"accounts">["provider"],
  label: string,
  address: string,
  opts: { onePerUser?: boolean } = {},
): Promise<{ id: string }> {
  const index = await addressIndex(await keysFor(userId), address);
  const find = (column: "address_index" | "address", value: string) =>
    db.from("accounts").select("id").eq("user_id", userId).eq("provider", provider).eq(column, value).limit(1);
  const existing = must(await find("address_index", index), "find account")[0] ?? must(await find("address", address), "find account")[0];
  const fields = { label, status: "connecting" as const, status_detail: null };
  if (existing) {
    must(await db.from("accounts").update(fields).eq("id", existing.id), `save ${provider} account`);
    return existing;
  }
  const only = opts.onePerUser ? must(await db.from("accounts").select("id").eq("user_id", userId).eq("provider", provider).order("created_at").limit(1), "find account")[0] : undefined;
  if (only) {
    must(await db.from("accounts").update({ ...fields, address: await sealAddress(userId, address), address_index: index }).eq("id", only.id), `save ${provider} account`);
    return only;
  }
  const row = { user_id: userId, provider, address: await sealAddress(userId, address), address_index: index, ...fields };
  return must(await db.from("accounts").insert(row).select("id").single(), `save ${provider} account`);
}

/** The user with this sign-in email, or null. Pages through every user, 200 at a time. */
export async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
}

async function findOrCreateUser(email: string): Promise<string> {
  const existing = await findUserId(email);
  if (existing) return existing;
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

/** Finds or creates the user and makes sure they have a profile row. */
export async function ownerUserId(email: string): Promise<string> {
  const userId = await findOrCreateUser(email);
  must(await db.from("profiles").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true }), "create profile");
  return userId;
}

/** Reads one line from the terminal. When hidden, nothing typed is echoed, so a password never shows. */
export async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") process.exit(130); // Ctrl+C
        if (ch === "\u007f") {
          // Backspace
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (!hidden) process.stdout.write("\b \b");
          }
          continue;
        }
        if (ch === "\u001b") continue; // ignore escape sequences from pasting
        value += ch;
        if (!hidden) process.stdout.write(ch);
      }
    };
    stdin.on("data", onData);
  });
}
