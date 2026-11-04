// The encryption switches, shared by the browser, the web server and the sync worker. Encryption is ON unless a
// flag is explicitly "false", so a deploy built from the example files stores ciphertext. In production a
// service that finds one explicitly off refuses to start (docs/PLAN.md, Privacy and Encryption, Code Check).
// Readers accept plaintext and ciphertext either way, so turning a flag off never breaks existing rows.

/** Whether a flag reads as enabled: anything except an explicit "false" (or "0", "off", "no"). */
export function flagOn(value: string | undefined | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "off" || v === "no");
}

/**
 * Whether a switch that defaults to off is turned on: only an explicit "true" (or "1", "on", "yes"). Used for the rollout
 * switches of bound values (SEAL_BOUND_FIELDS, REQUIRE_BOUND_FIELDS), which must wait for every reader to be released.
 */
export function flagTrue(value: string | undefined | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

/** The flags that must not be off in production. */
export const ENCRYPTION_FLAGS = ["ENCRYPT_CONTENT", "ENCRYPT_ADDRESSES"] as const;
export const PUBLIC_ENCRYPTION_FLAGS = ["NEXT_PUBLIC_ENCRYPT_CONTENT", "NEXT_PUBLIC_ENCRYPT_ADDRESSES"] as const;

/**
 * A message naming every flag that is explicitly off, or null when it is fine to start. Only production is
 * refused; development may turn encryption off to look at raw rows.
 */
export function encryptionOffError(env: Record<string, string | undefined>, names: readonly string[]): string | null {
  if (env.NODE_ENV !== "production") return null;
  const off = names.filter((n) => env[n] !== undefined && !flagOn(env[n]));
  if (off.length === 0) return null;
  return `${off.join(" and ")} ${off.length === 1 ? "is" : "are"} set to false in production. Konva will not run with encryption off. Remove the setting (it defaults to on) or set it to true.`;
}
