// Configuration from apps/worker/.env. Fails fast with a readable message rather than half-starting.

import { encryptionOffError, ENCRYPTION_FLAGS, flagOn } from "@messages/crypto/flags";
import { shardCount, shardError, shardIndex } from "./shard";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} in apps/worker/.env. See apps/worker/.env.example for where to find it.`);
    process.exit(1);
  }
  return value;
}

// Encryption is on unless a flag is explicitly "false". In production the worker will not start with one off.
const encryptionOff = encryptionOffError(process.env, ENCRYPTION_FLAGS);
if (encryptionOff) {
  console.error(encryptionOff);
  process.exit(1);
}

// Running several workers: which slice of the accounts this one syncs (see shard.ts and the README).
if (shardError) {
  console.error(shardError);
  process.exit(1);
}

export const env = {
  supabaseUrl: required("SUPABASE_URL"),
  serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  /**
   * The old static key that sealed every connector sign-in ("v1:"). Only needed to read sign-ins that
   * `pnpm credentials:reseal` has not moved to the per-user key ("v2:") yet. Leave it out once none are left.
   */
  encryptionKey: process.env.ENCRYPTION_KEY ?? "",
  /** How far back the first sync of an email account reaches. */
  initialSyncDays: Number(process.env.INITIAL_SYNC_DAYS ?? 30),
  /** The Google Cloud OAuth client (Desktop app type). Optional: only Gmail and Calendar need it. */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  /** The web app's Google OAuth client (Web application type), for sign-ins made in the app. The same values as in apps/web/.env.local. */
  googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID ?? "",
  googleWebClientSecret: process.env.GOOGLE_WEB_CLIENT_SECRET ?? "",
  /** The Microsoft Entra app (public client, "Mobile and desktop applications"). Optional: only Outlook needs it. */
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID ?? "",
  /** Only for an app registered as a confidential client. A public client leaves it empty. */
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
  /** The Zoom Marketplace app (General app, user-managed), for Zoom accounts connected in the app. The same values as in apps/web/.env.local. */
  zoomClientId: process.env.ZOOM_CLIENT_ID ?? "",
  zoomClientSecret: process.env.ZOOM_CLIENT_SECRET ?? "",
  /** Wraps each user's data key (packages/crypto/src/wrap.ts). Needed to read or write encrypted text. */
  keyWrappingKey: process.env.KEY_WRAPPING_KEY ?? "",
  /** The Google Cloud KMS key that wraps data keys (kms:v1). When set, new keys are wrapped by KMS; see packages/crypto/src/wrap.ts. */
  kmsKeyName: process.env.KMS_KEY_NAME ?? "",
  /** On unless "false": message text and the other content fields are stored encrypted. Either kind is read. */
  encryptContent: flagOn(process.env.ENCRYPT_CONTENT),
  /** On unless "false": addresses, numbers and chat IDs are stored encrypted (encryption stage 2); they are matched on their blind indexes either way. */
  encryptAddresses: flagOn(process.env.ENCRYPT_ADDRESSES),
  /** "true" works the shared company logo queue (src/logos). Off until the logo system is rolled out. */
  companyLogos: process.env.COMPANY_LOGOS === "true",
  /** This worker's slice of the accounts: shard `shardIndex` of `shardCount`. The defaults (0 of 1) are one worker that owns everything. */
  shardIndex,
  shardCount,
  /** On unless "off": one worker per shard at a time, enforced by a lease in the database (src/lease.ts). "off" is for local development. */
  lease: process.env.WORKER_LEASE !== "off",
};
