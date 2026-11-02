// Prints a new VAPID key pair for web push. Run with: pnpm --filter worker vapid:generate
// Copy the public key to NEXT_PUBLIC_VAPID_PUBLIC_KEY (apps/web) and VAPID_PUBLIC_KEY (apps/worker), the private key to
// VAPID_PRIVATE_KEY (apps/worker only), and set VAPID_SUBJECT. Nothing is written to disk. Replacing the pair later
// makes every existing subscription stop working: people enable push again.

import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
