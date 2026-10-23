import { db, must } from "../src/db";

// The Messages user an account belongs to, found by the email you sign in to the app with, and the
// terminal prompt the setup scripts use, hidden for passwords.

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
