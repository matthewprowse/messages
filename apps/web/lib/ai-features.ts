// The AI features the budget divides money between, with the names Admin shows for them, and the dollar format the Admin
// views share. The keys are the ones in ai_budget.shares and ai_usage.feature (apps/ai/ai/gemini_types.py). A key the
// database has that is not listed here is not hidden: lib/admin-budget.ts keeps it and Admin shows it by its key.

export const AI_FEATURES: { key: string; label: string; note: string }[] = [
  { key: "triage", label: "Sorting and Junk", note: "Sorts new mail. Pausing it leaves new mail unsorted until the 1st." },
  { key: "draft", label: "Drafts", note: "Automatic and on-request drafts, regenerations and voice drafts." },
  { key: "learn", label: "Learning From Edits", note: "Reads your edits and embeds mail for search." },
  { key: "brief", label: "Daily Brief", note: "The daily brief and its spoken version." },
  { key: "transcribe", label: "Transcripts", note: "Voice note and meeting transcripts." },
  { key: "bulk_read", label: "Readable Bulk Email", note: "The short readable version of a newsletter or marketing email, made when it is opened." },
  { key: "documents", label: "Document Cards", note: "The type, amount and due date read from a PDF or scanned document, for files you ask about and files from your contacts." },
];

/** The name of a feature, or its key when Admin does not know it yet. */
export const featureLabel = (key: string) => AI_FEATURES.find((f) => f.key === key)?.label ?? key;

/** When apps/ai/ai/pricing.py was last checked against Google's prices, and the next change it encodes. Update with pricing.py. */
export const PRICES_CHECKED = "22 October 2026";
export const PRICES_CHANGE = "1 January 2027";

/** Dollars for the budget fields: always two places. */
export const money = (usd: number) => `$${usd.toFixed(2)}`;

/** Dollars for small spend: three places under a dollar so a few cents do not read as nothing. */
export const spend = (usd: number) => (usd === 0 ? "$0.00" : usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`);
