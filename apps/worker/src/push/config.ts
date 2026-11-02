// The VAPID keys the worker signs pushes with, from apps/worker/.env. Without all three the sender stays off and says
// so once. The public key is the same value as NEXT_PUBLIC_VAPID_PUBLIC_KEY in apps/web/.env.local.

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** A mailto: or https: contact the push services can reach if the sender misbehaves. */
  subject: string;
}

/** Reads the keys from an environment; null when any is missing or the subject is not a mailto: or https: address. */
export function readVapid(e: Record<string, string | undefined>): VapidConfig | null {
  const publicKey = e.VAPID_PUBLIC_KEY?.trim(), privateKey = e.VAPID_PRIVATE_KEY?.trim(), subject = e.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}
