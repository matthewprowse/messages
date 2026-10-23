// Phone numbers in email signatures, and phone number normalisation to E.164.
// Pure functions, so they can be unit tested.

/** Calling codes of one or two digits. Every other country code has three (codes are prefix free). */
const ONE_DIGIT = new Set(["1", "7"]);
const TWO_DIGIT = new Set([
  "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46", "47", "48", "49",
  "51", "52", "53", "54", "55", "56", "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84",
  "86", "90", "91", "92", "93", "94", "95", "98",
]);

export const DEFAULT_COUNTRY_CODE = "27";

/** The country calling code of an E.164 number ("+27821234567" is "27"), or null when it is not one. */
export function countryCodeOf(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (ONE_DIGIT.has(digits[0])) return digits[0];
  if (TWO_DIGIT.has(digits.slice(0, 2))) return digits.slice(0, 2);
  return digits.slice(0, 3);
}

/**
 * A phone number in E.164 ("+27821234567"), or null when it cannot be told for certain.
 * Local numbers ("082 123 4567") take the given country code. WhatsApp privacy IDs ("...@lid") are not
 * phone numbers and give null.
 */
export function toE164(raw: string, countryCode: string = DEFAULT_COUNTRY_CODE): string | null {
  if (!raw || raw.includes("@")) return null;
  let s = raw.trim().replace(/^tel:/i, "").replace(/\(0\)/g, "");
  if (/[a-z]/i.test(s.replace(/\s*(ext|x)\.?\s*\d+\s*$/i, ""))) return null;
  s = s.replace(/\s*(ext|x)\.?\s*\d+\s*$/i, ""); // an extension is not part of the number
  const plus = s.startsWith("+");
  let digits = s.replace(/\D/g, "");
  let full: string;
  if (plus) full = digits;
  else if (digits.startsWith("00")) full = digits.slice(2);
  else if (countryCode === "1") {
    if (digits.length === 10) full = "1" + digits;
    else if (digits.length === 11 && digits.startsWith("1")) full = digits;
    else return null;
  } else if (digits.startsWith("0")) {
    full = countryCode + (countryCode === "39" ? digits : digits.slice(1)); // Italy keeps its leading zero
  } else if (digits.startsWith(countryCode) && digits.length >= countryCode.length + 8) {
    full = digits;
  } else return null;
  digits = full;
  if (digits.length < 9 || digits.length > 15 || digits.startsWith("0")) return null;
  const cc = countryCodeOf(digits);
  if (!cc || digits.length - cc.length < 7) return null;
  if (cc === "1" && (digits.length !== 11 || !/^[2-9]/.test(digits.slice(1)))) return null; // North American area codes
  return "+" + digits;
}

const SIGN_OFF =
  /^(kind(est)? regards|best regards|warm(est)? regards|regards|best wishes|best|cheers|thanks|thank you|many thanks|thanks again|thanks so much|sincerely|yours sincerely|yours faithfully|yours truly|yours|warmly|take care|groete|vriendelike groete|baie dankie|dankie|mvg|met vriendelijke groet|mit freundlichen gr(u|ü)(ss|ß)en|cordialement)\b[\s,.!]*$/i;

const PHONE_LABEL = /\b(tel|tele|telephone|phone|ph|mobile|mob|cell|cellphone|cel|whatsapp|direct|landline|office)\b\.?\s*(no\.?|number)?\s*[:.]?\s*$|(^|[\s|•·,;(])[mtpcw]\s*:\s*$/i;
const FAX_LABEL = /\bfax\b/i;
const NOT_A_PHONE =
  /\b(order|invoice|inv|ref|reference|acc|account|acct|booking|tracking|track|policy|vat|reg|registration|company no|customer|client|member|id|pin|otp|code|serial|ticket|case|claim|parcel|waybill|receipt|transaction|iban|swift|branch|isbn)\b|#|№/i;
const CURRENCY = /(R|ZAR|\$|USD|€|EUR|£|GBP)\s*$/i;
/** Words that mean a number in a sentence belongs to someone else: "reach my colleague Jane on". */
const SOMEONE_ELSE =
  /\b(his|her|their)\b|\b(my|our)\s+(\w+\s+)?(colleagues?|wife|husband|partner|assistant|secretary|son|daughter|brother|sister|mother|father|mom|mum|dad|friend|manager|boss|team|office)\b|\b\w+['’]s\s+(number|cell|mobile|phone|whatsapp)\b|\b(reach|call|contact|ring|text|try|phone)\s+(?!(me|us|on|at|number|no|nr|details|direct|now|anytime)\b|\d|\+)\w+/i;
/** A reply header in many languages: "On ... wrote:", "Op ... het ... geskryf:", "Am ... schrieb ...:". */
const QUOTE_VERB = /(^|[\s,])(wrote|geskryf|schreef|schrieb|a écrit|escribió|escribio|ha scritto|skrev|kirjoitti|napisał|escreveu|написал)(?=[\s:]|$)/i;

/** Text without quoted replies and forwarded messages: what the sender wrote in this email. */
export function ownText(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (/^>/.test(t)) break;
    if (/^On .{4,}wrote:$/i.test(t)) break;
    if (/^On .{4,}/i.test(t) && /wrote:$/i.test((lines[i + 1] ?? "").trim())) break;
    // Other languages, or headers wrapped over two lines: a "wrote" verb ending in a colon, near an
    // address or a date.
    const next = (lines[i + 1] ?? "").trim();
    if (/[@\d]/.test(t) && QUOTE_VERB.test(t) && /:\s*$/.test(t)) break;
    if (/[@\d]/.test(t) && next.length <= 40 && QUOTE_VERB.test(next) && /:\s*$/.test(next)) break;
    if (/<[^>]+@[^>]+>.*:\s*$/.test(t)) break;
    if (/^-{2,}\s*(original message|forwarded message)/i.test(t)) break;
    if (/^(begin forwarded message|forwarded message)/i.test(t)) break;
    if (/^_{8,}$/.test(t)) break; // Outlook's separator above a quoted message
    if (/^From:\s*\S/i.test(t) && lines.slice(i + 1, i + 5).some((l) => /^(sent|date|to|subject):/i.test(l.trim()))) break;
    out.push(line);
  }
  return out;
}

/** Candidate number strings with where they start in the line. */
function candidates(line: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  for (const m of line.matchAll(/(?:\+|\b00)?\(?\d[\d\s().\-/]{6,}\d/g)) out.push({ text: m[0], start: m.index ?? 0 });
  return out;
}

function looksLikeDate(s: string): boolean {
  const t = s.trim();
  return (
    /^\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}$/.test(t) ||
    /^(19|20)\d{2}[\s/.\-]?\d{2}[\s/.\-]?\d{2}$/.test(t) ||
    /^\d{1,2}:\d{2}/.test(t)
  );
}

/** Phone numbers in one line. labelledOnly: only numbers with a Tel, Mobile, Cell or Phone label. */
function phonesInLine(line: string, countryCode: string, labelledOnly: boolean): string[] {
  const out: string[] = [];
  let prevEnd = 0;
  for (const c of candidates(line)) {
    const before = line.slice(prevEnd, c.start);
    const near = line.slice(Math.max(0, c.start - 24), c.start);
    prevEnd = c.start + c.text.length;
    const after = line.slice(prevEnd, prevEnd + 3);
    const text = c.text.trim();
    const digits = text.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) continue;
    if (looksLikeDate(text)) continue;
    if (/[.,]\d{2}$/.test(text) && !/\s/.test(text.slice(-4))) continue; // 1234.56 is a price
    if (/^[.,]\d/.test(after) || /^%/.test(after.trim())) continue; // part of an amount or a percentage
    if (CURRENCY.test(near)) continue;
    if (FAX_LABEL.test(before)) continue;
    const labelled = PHONE_LABEL.test(before) || PHONE_LABEL.test(near);
    if (!labelled && NOT_A_PHONE.test(before)) continue;
    if (!labelled && /\//.test(text)) continue; // registration numbers and dates use slashes
    if (labelledOnly && !labelled) continue;
    if (SOMEONE_ELSE.test(line.slice(0, c.start))) continue; // "reach my colleague Jane on 082 ..."
    if (!labelled && before.trim().split(/\s+/).filter((w) => /[a-z]/i.test(w)).length > 6) continue; // a sentence, not a signature line
    const e164 = toE164(text, countryCode);
    if (e164) out.push(e164);
  }
  return out;
}

/**
 * Phone numbers in the signature area of an email's text, in E.164, without duplicates.
 * These merge contacts automatically, so only numbers that are the sender's count: short lines after a
 * sign-off ("Kind regards") or a "--" line, and numbers with a phone label (Tel, Mobile, Cell, Phone, M:,
 * T:). A number in a sentence about someone else ("reach my colleague on") never counts, and quoted
 * replies are left out, so another person's signature in a reply is never read.
 */
export function signaturePhones(text: string | null | undefined, countryCode: string = DEFAULT_COUNTRY_CODE): string[] {
  if (!text) return [];
  const lines = ownText(text).slice(0, 400);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const area = new Set<number>();
  let signOff = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^-{2,3}$/.test(t) || (t.length <= 40 && SIGN_OFF.test(t))) {
      signOff = i;
      break;
    }
  }
  if (signOff >= 0) for (let i = signOff + 1; i < Math.min(lines.length, signOff + 25); i++) area.add(i);

  const found = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const inArea = area.has(i);
    for (const p of phonesInLine(lines[i], countryCode, !inArea)) found.add(p);
  }
  return [...found];
}
