import { db } from "../src/db";
import { ask, findUserId } from "./owner";

// Sets the password you sign in to the Messages app with. Typed only into your terminal, never printed.
// Run with: pnpm set-password

async function main() {
  const email = (await ask("Your Messages sign-in email: ")).trim().toLowerCase();
  const password = await ask("New password (hidden): ", true);
  const confirm = await ask("Repeat it (hidden): ", true);
  if (password.length < 10) {
    console.error("Use at least 10 characters.");
    process.exit(1);
  }
  if (password !== confirm) {
    console.error("Those did not match.");
    process.exit(1);
  }

  const userId = await findUserId(email);
  if (userId) {
    const result = await db.auth.admin.updateUserById(userId, { password });
    if (result.error) throw result.error;
    console.log("Password set. Sign in to the app with it.");
    process.exit(0);
  }
  console.error("No user with that email. It must match the email you gave pnpm connect:icloud.");
  process.exit(1);
}

main().catch((err) => {
  console.error("Could not set the password.", (err as { code?: string }).code ?? "");
  process.exit(1);
});
