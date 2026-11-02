// Which notes marked Use in Drafts actually reach a draft. Pure: it repeats the AI worker's limits (apps/ai/ai/drafts_context.py
// pick_facts and the compose_context SQL: at most 15 notes in id order, each cut to 1,500 characters, all of them to 6,000)
// so the app can say when a note is cut or left out. Keep the numbers in step with those files.

export const FACT_NOTES = 15;
export const FACT_NOTE_CHARS = 1500;
export const FACTS_CHARS = 6000;

export interface FactNote { id: string; body: string; excerpt: string | null; unloaded?: boolean; useInDrafts: boolean }

export interface FactsReport {
  /** Notes marked Use in Drafts. */
  marked: number;
  /** Of those, notes that reach drafts (whole or cut). */
  used: number;
  /** Notes cut short, by the per-note limit or the shared one. */
  shortened: Set<string>;
  /** Notes that do not reach drafts at all: past the 15th, or after the shared limit ran out. */
  leftOut: Set<string>;
  /** Some text was not downloaded, so lengths come from the excerpt and a cut may be missed. */
  approximate: boolean;
}

/** What the AI worker would take from these notes. Notes with no text are marked but never counted as used. */
export function draftFacts(notes: FactNote[]): FactsReport {
  const marked = notes.filter((n) => n.useInDrafts).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const report: FactsReport = { marked: marked.length, used: 0, shortened: new Set(), leftOut: new Set(), approximate: false };
  let room = FACTS_CHARS;
  marked.forEach((n, i) => {
    if (i >= FACT_NOTES) { report.leftOut.add(n.id); return; }
    if (n.unloaded) report.approximate = true;
    const text = (n.unloaded ? n.excerpt ?? "" : n.body).trim();
    if (!text) return;
    if (room <= 0) { report.leftOut.add(n.id); return; }
    let len = Math.min(text.length, FACT_NOTE_CHARS);
    if (len < text.length) report.shortened.add(n.id);
    if (len > room) { len = room; report.shortened.add(n.id); }
    room -= len;
    report.used += 1;
  });
  return report;
}

/** How one note stands for drafts: not marked, used whole, cut short, or left out. */
export function factStatus(report: FactsReport, note: { id: string; useInDrafts: boolean }): "off" | "used" | "cut" | "left-out" {
  if (!note.useInDrafts) return "off";
  if (report.leftOut.has(note.id)) return "left-out";
  return report.shortened.has(note.id) ? "cut" : "used";
}
