// Digit-only forms of phone numbers for the contact search, so "082 123 4567", "+27 82 123 4567" and a stored
// "27821234567" all find each other. Pure, so it can be unit tested.

/** Digits only, with a South African national "0" prefix turned into "27". Other numbers keep their digits. */
export function searchDigits(s: string): string {
  const d = s.replace(/\D/g, "");
  // "0" then nine digits is a South African national number; "00" is an international dialling prefix.
  if (/^0\d{9}$/.test(d)) return "27" + d.slice(1);
  if (d.startsWith("00")) return d.slice(2);
  return d;
}

/** Whether the typed text is only digits and number punctuation, so it can be read as part of a number. */
export function looksLikePhoneQuery(q: string): boolean {
  return /^[\d\s+().-]+$/.test(q) && q.replace(/\D/g, "").length >= 3;
}

/**
 * Whether a typed number is part of any of the stored numbers (space separated digits). A partial national query
 * such as "082 12" is also tried with its leading 0 read as 27, so it matches the stored international form.
 */
export function phoneQueryMatches(q: string, storedDigits: string): boolean {
  if (!looksLikePhoneQuery(q)) return false;
  const raw = q.replace(/\D/g, "");
  if (storedDigits.includes(raw)) return true;
  const national = raw.startsWith("0") && !raw.startsWith("00") ? "27" + raw.slice(1) : searchDigits(q);
  return national.length >= 3 && storedDigits.includes(national);
}
