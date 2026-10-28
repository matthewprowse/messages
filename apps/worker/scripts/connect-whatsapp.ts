// Links WhatsApp to Messages as a linked device, from the terminal. The running worker does the linking
// (one connection only, so the history your phone sends is caught); this shows its QR code here as it
// changes, or a pairing code to type on your phone. Run with: pnpm connect:whatsapp

import { encodeQr, qrToTerminal } from "@messages/qr";
import { db, must } from "../src/db";
import { sleep } from "../src/backoff";
import { ask, ownerUserId } from "./owner";

const POLL_MS = 1_500;
const NO_WORKER_MS = 45_000; // the worker picks up a new link within 30 seconds
const GIVE_UP_MS = 5 * 60_000;

async function main() {
  console.log("\nLink WhatsApp\n");
  console.log("Messages joins your WhatsApp as a linked device, like WhatsApp Web. Your phone must come online");
  console.log("at least once every 14 days or WhatsApp unlinks it. Linking an unofficial client can get a number");
  console.log("banned; Messages never sends anything on its own.\n");
  const ownerEmail = (await ask("Email you will sign in to the Messages app with: ")).trim().toLowerCase();
  const phone = (await ask("To link with a code instead of the QR code, your WhatsApp number with country code (press Enter for the QR code): ")).trim();
  if (!ownerEmail) {
    console.error("\nThe email is required.");
    process.exit(1);
  }

  const userId = await ownerUserId(ownerEmail);
  const { data: accountId, error } = await db.rpc("request_whatsapp_link", { p_user: userId, p_phone: phone || undefined });
  if (error) {
    console.error(`\n${error.message}`);
    process.exit(1);
  }

  console.log("\nWaiting for the worker. Keep it running in another terminal: pnpm worker\n");
  const started = Date.now();
  let shown: string | null = null;
  let warned = false;
  for (;;) {
    const account = must(
      await db.from("accounts").select("status, status_detail, qr_code, pairing_code, address").eq("id", accountId).single(),
      "load account",
    );

    if (account.status === "connected" || account.status === "syncing") {
      console.log(`\nLinked${account.address ? ` as ${account.address}` : ""}. Your chats are importing now.\n`);
      process.exit(0);
    }
    if (account.status === "error") {
      console.error(`\n${account.status_detail ?? "Linking failed."} Run pnpm connect:whatsapp to try again.\n`);
      process.exit(1);
    }

    const next = account.pairing_code ? `code:${account.pairing_code}` : account.qr_code ? `qr:${account.qr_code}` : null;
    if (next && next !== shown) {
      shown = next;
      if (account.pairing_code) {
        console.log(`Pairing code: ${account.pairing_code}\n`);
        console.log("On your phone: WhatsApp, Settings, Linked Devices, Link a Device, then Link With Phone Number Instead.\n");
      } else {
        console.clear();
        console.log("Scan with your phone: WhatsApp, Settings, Linked Devices, Link a Device.\n");
        console.log(qrToTerminal(encodeQr(account.qr_code!)));
        console.log("\nThe code refreshes every 20 seconds or so. It is also shown in the app under Settings, Accounts, WhatsApp.\n");
      }
    }

    const waited = Date.now() - started;
    if (!next && !warned && waited > NO_WORKER_MS) {
      warned = true;
      console.log("No code yet. Is the worker running? Start it with: pnpm worker");
    }
    if (waited > GIVE_UP_MS) {
      console.error("\nStopped waiting. Run pnpm connect:whatsapp again once the worker is running.");
      process.exit(1);
    }
    await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error("Something went wrong starting the link.", (err as { code?: string }).code ?? "");
  process.exit(1);
});
