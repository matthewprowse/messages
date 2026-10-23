// Configuration from apps/worker/.env. Fails fast with a readable message rather than half-starting.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} in apps/worker/.env. See apps/worker/.env.example for where to find it.`);
    process.exit(1);
  }
  return value;
}

export const env = {
  supabaseUrl: required("SUPABASE_URL"),
  serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  encryptionKey: required("ENCRYPTION_KEY"),
  /** How far back the first sync of an email account reaches. */
  initialSyncDays: Number(process.env.INITIAL_SYNC_DAYS ?? 30),
  /** The Google Cloud OAuth client (Desktop app type). Optional: only Gmail and Calendar need it. */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  /** Wraps each user's data key (packages/crypto/src/wrap.ts). Needed to read or write encrypted text. */
  keyWrappingKey: process.env.KEY_WRAPPING_KEY ?? "",
  /** "true" stores message text encrypted; otherwise it is stored as before, and either kind is read. */
  encryptContent: process.env.ENCRYPT_CONTENT === "true",
  /** "true" stores addresses, numbers and chat IDs encrypted (encryption stage 2); they are matched on their blind indexes either way. */
  encryptAddresses: process.env.ENCRYPT_ADDRESSES === "true",
};
