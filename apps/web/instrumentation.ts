// Runs once when the server starts. In production the web app (which is also the key service) refuses to
// serve with an encryption flag explicitly off, so a deploy cannot quietly store plaintext.

import { encryptionOffError, ENCRYPTION_FLAGS, PUBLIC_ENCRYPTION_FLAGS } from "@messages/crypto/flags";

export function register() {
  const problem = encryptionOffError(process.env, [...ENCRYPTION_FLAGS, ...PUBLIC_ENCRYPTION_FLAGS]);
  if (problem) throw new Error(problem);
}
