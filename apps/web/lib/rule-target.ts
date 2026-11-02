// Turns what someone types into a priority rule (an email address, a phone number or a domain) into the one form
// senders are matched on: lower case, "@example.co.za" as a domain, and a South African number as +27. Pure.

export type RuleTarget = { ok: true; value: string } | { ok: false; error: string };

const BAD = "Enter an email address, a phone number like +27 82 123 4567, or a domain like company.co.za.";

/** The normalised target, or why the text cannot be one. */
export function normaliseRuleTarget(input: string): RuleTarget {
  const text = input.trim().toLowerCase();
  if (!text) return { ok: false, error: BAD };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return { ok: true, value: text };
  const domain = text.replace(/^@/, "").replace(/\.$/, "");
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) && /[a-z]/.test(domain)) return { ok: true, value: domain };
  const digits = text.replace(/[\s().-]/g, "");
  if (/^\+?[0-9]{7,15}$|^00[0-9]{7,15}$/.test(digits)) {
    if (digits.startsWith("+")) return { ok: true, value: digits };
    if (digits.startsWith("00")) return { ok: true, value: `+${digits.slice(2)}` };
    // A South African number written the local way: 082 123 4567.
    if (digits.startsWith("0") && digits.length === 10) return { ok: true, value: `+27${digits.slice(1)}` };
    if (digits.startsWith("27") && digits.length === 11) return { ok: true, value: `+${digits}` };
    return { ok: true, value: `+${digits}` };
  }
  return { ok: false, error: BAD };
}
