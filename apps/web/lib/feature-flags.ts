// Feature flags and kill switches in the web app: what Admin lists and lets the owner edit, a short-lived cached read for the
// signed-in person (feature_flag_state answers for them only), and the small parsers. The workers read the same table
// (apps/worker/src/flags.ts, apps/ai/ai/flags.py). A flag that is on is a switch thrown.

export interface FlagInfo { key: string; label: string; area: string }

/** The seeded switches in the order Admin shows them. A key the database has that is not listed is still shown, by its key. */
export const FLAGS: FlagInfo[] = [
  { key: "pause_all_ai", label: "Pause All AI", area: "AI" },
  { key: "pause_predrafts", label: "Pause Pre-Drafts", area: "AI" },
  { key: "pause_documents", label: "Pause Reading Documents", area: "AI" },
  { key: "pause_automations", label: "Pause Automations", area: "AI" },
  { key: "disable_connector_instagram", label: "Disable Instagram Connector", area: "Connectors" },
  { key: "disable_connector_linkedin", label: "Disable LinkedIn Connector", area: "Connectors" },
  { key: "disable_sends", label: "Disable Sends", area: "Sending" },
];

export const flagLabel = (key: string) => FLAGS.find((f) => f.key === key)?.label ?? key;

export interface AdminFlag { key: string; enabled: boolean; description: string; emails: string[]; updated_at: string }

/** Known flags first in their listed order, then any others by key. */
export function orderFlags(rows: AdminFlag[]): AdminFlag[] {
  const rank = (k: string) => { const i = FLAGS.findIndex((f) => f.key === k); return i < 0 ? FLAGS.length : i; };
  return [...rows].sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

export type EmailsParse = { ok: true; emails: string[] } | { ok: false; bad: string };

/** The people box: emails separated by commas, spaces or new lines. Lowercased, no repeats; the first thing that is not an email is reported. */
export function parseEmails(text: string): EmailsParse {
  const parts = text.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const bad = parts.find((p) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p));
  if (bad) return { ok: false, bad };
  return { ok: true, emails: [...new Set(parts)] };
}

/** Whether saving would change anything, so Save stays off for an untouched row. */
export const flagChanged = (row: AdminFlag, enabled: boolean, emails: string[]): boolean =>
  row.enabled !== enabled || [...row.emails].sort().join(",") !== [...emails].sort().join(",");

/** The state map from feature_flag_state: only true values count, anything else is off. */
export function flagOn(state: unknown, key: string): boolean {
  return typeof state === "object" && state !== null && (state as Record<string, unknown>)[key] === true;
}

const TTL_MS = 30_000;
let cached: { at: number; state: unknown } | null = null;

/** The signed-in person's switches, cached for 30 s. `read` is the rpc call; a failure answers "all off" and is not cached. */
export async function readFlagState(read: () => Promise<unknown>, now = Date.now()): Promise<unknown> {
  if (cached && now - cached.at < TTL_MS) return cached.state;
  try {
    const state = await read();
    cached = { at: now, state };
    return state;
  } catch {
    return {};
  }
}

/** Forgets the cached state (after the owner changes a switch, and for tests). */
export const resetFlagState = () => { cached = null; };
