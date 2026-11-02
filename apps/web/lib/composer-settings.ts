// What the reply box remembers for each email account: a signature for every address you send from, and which
// address you write as by default. Stored as one sealed JSON string per account (account_composer.settings), so this
// is the whole format. Pure: use-account-composer.ts does the saving.

/** Longest signature kept, in characters: a few lines of name, role and contact details. */
export const MAX_SIGNATURE = 1000;

export interface AccountComposer {
  /** Signature text by lowercase send address. Addresses with no signature are not listed. */
  signatures: Record<string, string>;
  /** The address new emails and replies are written as when nothing else decides. Lowercase. */
  defaultFrom?: string;
}

export const EMPTY_COMPOSER: AccountComposer = { signatures: {} };

/** A signature as typed: line breaks kept, trailing spaces and blank lines at the ends dropped, capped in length. */
export function cleanSignature(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trim().slice(0, MAX_SIGNATURE);
}

/** Reads the stored JSON. Anything unreadable gives the empty settings rather than an error, so the box still works. */
export function parseComposer(json: string | null | undefined): AccountComposer {
  if (!json) return EMPTY_COMPOSER;
  try {
    const raw = JSON.parse(json) as { signatures?: unknown; defaultFrom?: unknown };
    const signatures: Record<string, string> = {};
    if (raw.signatures && typeof raw.signatures === "object") {
      for (const [address, text] of Object.entries(raw.signatures)) {
        const clean = typeof text === "string" ? cleanSignature(text) : "";
        if (clean) signatures[address.trim().toLowerCase()] = clean;
      }
    }
    const defaultFrom = typeof raw.defaultFrom === "string" && raw.defaultFrom.trim() ? raw.defaultFrom.trim().toLowerCase() : undefined;
    return { signatures, ...(defaultFrom && { defaultFrom }) };
  } catch {
    return EMPTY_COMPOSER;
  }
}

/** The JSON to seal and store. Empty signatures are left out. */
export function serializeComposer(c: AccountComposer): string {
  return JSON.stringify(parseComposer(JSON.stringify(c)));
}

/** The signature for an address, or "" when there is none. */
export function signatureFor(c: AccountComposer | undefined, address: string | undefined): string {
  return (address && c?.signatures[address.trim().toLowerCase()]) || "";
}

/** True when any address on the account has a signature (the plain flag the AI worker reads). */
export function hasAnySignature(c: AccountComposer): boolean {
  return Object.values(c.signatures).some((s) => s.trim().length > 0);
}

/** A copy with one address's signature set (empty removes it). */
export function withSignature(c: AccountComposer, address: string, text: string): AccountComposer {
  const signatures = { ...c.signatures };
  const clean = cleanSignature(text);
  const key = address.trim().toLowerCase();
  if (clean) signatures[key] = clean;
  else delete signatures[key];
  return { ...c, signatures };
}

/** A copy with the default send-from set, or cleared with undefined. */
export function withDefaultFrom(c: AccountComposer, address: string | undefined): AccountComposer {
  const { defaultFrom: _old, ...rest } = c;
  return address ? { ...rest, defaultFrom: address.trim().toLowerCase() } : rest;
}
