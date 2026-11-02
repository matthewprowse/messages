// Starting points offered when a note is made: Call Note, Meeting Note, Quote and Onboarding Checklist. Plain
// markdown with the checklist syntax the editor reads, so a template is just text until the person edits it.
// Pure: the date is passed in so tests do not depend on today.

export interface NoteTemplate {
  id: "call" | "meeting" | "quote" | "onboarding";
  name: string;
  /** The title the note starts with, with the date added where it helps. */
  title: (date: string) => string;
  body: string;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "call",
    name: "Call Note",
    title: (d) => `Call ${d}`,
    body: "## Who\n\n## What We Discussed\n\n- \n\n## Decisions\n\n- \n\n## Follow-Ups\n\n- [ ] \n",
  },
  {
    id: "meeting",
    name: "Meeting Note",
    title: (d) => `Meeting ${d}`,
    body: "## Attendees\n\n- \n\n## Agenda\n\n- \n\n## Notes\n\n## Decisions\n\n- \n\n## Action Items\n\n- [ ] \n",
  },
  {
    id: "quote",
    name: "Quote",
    title: (d) => `Quote ${d}`,
    body: "## Client\n\n## Scope\n\n- \n\n## Price\n\n- Item: R\n- VAT: R\n- Total: R\n\n## Terms\n\n- Valid for 30 days\n- Deposit due on acceptance\n\n## To Do\n\n- [ ] Send quote\n- [ ] Follow up in a week\n",
  },
  {
    id: "onboarding",
    name: "Onboarding Checklist",
    title: (d) => `Onboarding ${d}`,
    body: "## Client\n\n## Before The First Meeting\n\n- [ ] Send welcome message\n- [ ] Collect contact details\n- [ ] Agree scope and fees\n\n## Set Up\n\n- [ ] Sign agreement\n- [ ] Send first invoice\n- [ ] Share the shared folder\n\n## After\n\n- [ ] Book the first check-in\n",
  },
];

/** The title and text a new note starts with for this template. */
export function fromTemplate(t: NoteTemplate, date: string): { title: string; body: string } {
  return { title: t.title(date), body: t.body };
}

/** A short date for titles, such as "2 Nov 2026". */
export function shortDate(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
