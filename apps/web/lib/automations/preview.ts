// The answer to "what would this have done in the last 30 days", as the AI worker wrote it (automation_previews.result, opened in
// the browser), and the sentences shown for it before an automation is turned on. Pure.

export interface PreviewLead {
  name: string;
  /** The listing for a template, the subject line for a custom automation. */
  listing: string;
  at: string;
  enquiries: number;
}

export interface PreviewResult {
  /** "parsed": a template read each email and the count is of people. "matched": a custom automation, counted by email. */
  mode: "parsed" | "matched";
  matched: number;
  /** Matching emails the fixed parser could not read. A live run would ask Gemini about them. */
  unreadable: number;
  count: number;
  leads: PreviewLead[];
  /** The inbox was longer than the preview looks through. */
  cut: boolean;
}

/** The answer from its JSON text, or null when it is not one. */
export function readPreview(text: string | null | undefined): PreviewResult | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? "");
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.count !== "number" || !Array.isArray(r.leads)) return null;
  const leads: PreviewLead[] = [];
  for (const l of r.leads as unknown[]) {
    const e = l && typeof l === "object" ? (l as Record<string, unknown>) : null;
    if (e && typeof e.name === "string") leads.push({ name: e.name, listing: String(e.listing ?? ""), at: String(e.at ?? ""), enquiries: Number(e.enquiries) || 1 });
  }
  return { mode: r.mode === "matched" ? "matched" : "parsed", matched: Number(r.matched) || 0, unreadable: Number(r.unreadable) || 0, count: r.count, leads, cut: r.cut === true };
}

/** The headline: "In the last 30 days this would have made 14 leads." */
export function previewHeadline(p: PreviewResult): string {
  if (p.mode === "matched") return `In the last 30 days this would have run on ${p.count} ${p.count === 1 ? "email" : "emails"}.`;
  return `In the last 30 days this would have made ${p.count} ${p.count === 1 ? "lead" : "leads"}.`;
}

/** Smaller print under the headline, or null. */
export function previewNote(p: PreviewResult): string | null {
  const notes: string[] = [];
  if (p.mode === "parsed" && p.unreadable > 0) notes.push(`${p.unreadable} matching ${p.unreadable === 1 ? "email" : "emails"} could not be read by the fixed reader. A live run would ask the AI about ${p.unreadable === 1 ? "it" : "them"}.`);
  if (p.cut) notes.push("Your inbox is large, so only the newest emails were looked through.");
  if (p.mode === "matched") notes.push("A custom automation reads each email with the AI when it arrives, so nothing is read for this preview.");
  return notes.join(" ") || null;
}
