// Makes text comparable for search: lower case with accents removed, so "Zoë" is found by "zoe" and the other way round.
// Pure. Used for the index and for the query, so both sides fold the same way.

/** Lower case, accents stripped, spacing tidied. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Whether the match at `at` starts a word, so "inv" at the start of "invoice" counts for more than inside "reinvest". */
export function startsWord(text: string, at: number): boolean {
  if (at <= 0) return true;
  return !/[\p{L}\p{N}]/u.test(text[at - 1]);
}
