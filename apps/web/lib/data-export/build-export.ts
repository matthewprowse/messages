// Builds the Download My Data zip from an ExportSource. All the sequencing lives here, away from Supabase and the keys (those
// are in export-source.ts), so progress, cancelling, naming and what goes in the archive are tested with a fake source.
//
// Layout of the zip:
//   README.txt                       what is in it and when it was made
//   conversations/<name>.json|.txt   one pair per conversation, messages oldest first
//   contacts/contacts.csv, contacts.vcf
//   notes/<title>.md
//   tasks/tasks.json, tasks/promises.json, calendar/events.ics, calendar/events.json
//   profile/profile.json             name, About You, AI settings, rules, writing examples, connected accounts (never credentials)
//   files/<kind>/...                 only when attachments are chosen
//   problems.txt                     only when something could not be read; says what and why, never contents

import { conversationText, safeName, toCsv, uniquePath, icsCalendar, vcards, type ExportContact, type ExportEvent, type ExportLine } from "./formats";
import { ZipWriter } from "./zip-writer";

export interface SourceThread { id: string; title: string; channel: string; status: string; lastMessageAt: string }
export interface SourceMessage { id: string; sentAt: string; direction: "in" | "out"; who: string; address?: string; subject?: string; text: string; quoted?: string; transcript?: string; files: string[] }
export interface SourceNote { id: string; title: string; body: string; pinned: boolean; createdAt: string; updatedAt: string }
export interface SourceFile { id: string; name: string; kind: "attachment" | "note"; bytes: number }

/** Where the export reads from. Every method may throw; the build records the failure and carries on where it can. */
export interface ExportSource {
  threads(): Promise<SourceThread[]>;
  messages(thread: SourceThread): Promise<SourceMessage[]>;
  contacts(): Promise<ExportContact[]>;
  notes(): Promise<SourceNote[]>;
  tasks(): Promise<unknown[]>;
  /** Promises found in conversations; a source without them leaves the file out. */
  commitments?(): Promise<unknown[]>;
  events(): Promise<(ExportEvent & { calendar?: string | null })[]>;
  settings(): Promise<Record<string, unknown>>;
  /** Stored files, only asked for when attachments are chosen. */
  files(): Promise<SourceFile[]>;
  /** A file's readable bytes, or null when it is not there. */
  file(file: SourceFile): Promise<Uint8Array | null>;
}

export interface ExportProgress { stage: string; done: number; total: number }

export class ExportCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "ExportCancelled";
  }
}

const PARALLEL = 4; // conversations read at once: enough to hide the round trips, few enough to be gentle on the database

/** Runs `fn` over `items` with at most `limit` at a time, stopping early when `stop` says so. */
async function pool<T>(items: T[], limit: number, stop: () => void, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      stop();
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** The zip, or a rejection with ExportCancelled when `signal` aborts. */
export async function buildExport(source: ExportSource, options: { attachments: boolean }, onProgress: (p: ExportProgress) => void, signal: AbortSignal, now: Date = new Date()): Promise<Blob> {
  const stop = () => { if (signal.aborted) throw new ExportCancelled(); };
  const zip = new ZipWriter();
  const problems: string[] = [];
  const counts = { conversations: 0, messages: 0, contacts: 0, notes: 0, tasks: 0, events: 0, files: 0 };
  const note = async <T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    stop();
    try { return await run(); } catch (err) {
      if (err instanceof ExportCancelled) throw err;
      problems.push(`${what}: could not be read (${(err as { code?: string } | null)?.code ?? "error"}).`);
      return fallback;
    }
  };

  // Conversations
  const threads = await note("Conversations", () => source.threads(), [] as SourceThread[]);
  const taken = new Set<string>();
  let done = 0;
  onProgress({ stage: "Conversations", done, total: threads.length });
  await pool(threads, PARALLEL, stop, async (thread) => {
    const messages = await note(`A conversation (${thread.id})`, () => source.messages(thread), null as SourceMessage[] | null);
    done++;
    onProgress({ stage: "Conversations", done, total: threads.length });
    if (!messages) return;
    const base = uniquePath(taken, "conversations", safeName(thread.title, "Conversation"), "");
    const lines: ExportLine[] = messages.map((m) => ({ sentAt: m.sentAt, direction: m.direction, who: m.who, text: [m.text, m.transcript ? `[Voice note] ${m.transcript}` : ""].filter(Boolean).join("\n"), files: m.files }));
    zip.add(`${base}.txt`, conversationText(thread.title, thread.channel, lines));
    zip.add(`${base}.json`, JSON.stringify({ id: thread.id, title: thread.title, channel: thread.channel, status: thread.status, lastMessageAt: thread.lastMessageAt, messages }, null, 2));
    counts.conversations++;
    counts.messages += messages.length;
  });

  // Contacts
  onProgress({ stage: "Contacts", done: 0, total: 1 });
  const contacts = await note("Contacts", () => source.contacts(), [] as ExportContact[]);
  zip.add("contacts/contacts.csv", toCsv(["Name", "Company", "Role", "Emails", "Phones"], contacts.map((c) => [c.name, c.company, c.role, c.emails.join("; "), c.phones.join("; ")])));
  zip.add("contacts/contacts.vcf", vcards(contacts));
  counts.contacts = contacts.length;

  // Notes
  onProgress({ stage: "Notes", done: 0, total: 1 });
  const notes = await note("Notes", () => source.notes(), [] as SourceNote[]);
  const noteNames = new Set<string>();
  for (const n of notes) {
    const header = `---\ntitle: ${JSON.stringify(n.title)}\ncreated: ${n.createdAt}\nupdated: ${n.updatedAt}\npinned: ${n.pinned}\n---\n\n`;
    zip.add(uniquePath(noteNames, "notes", safeName(n.title, "Untitled Note"), ".md"), header + n.body);
  }
  counts.notes = notes.length;

  // Tasks and events
  onProgress({ stage: "Tasks and Calendar", done: 0, total: 1 });
  const tasks = await note("Tasks", () => source.tasks(), [] as unknown[]);
  zip.add("tasks/tasks.json", JSON.stringify(tasks, null, 2));
  if (source.commitments) zip.add("tasks/promises.json", JSON.stringify(await note("Promises", () => source.commitments!(), [] as unknown[]), null, 2));
  const events = await note("Calendar", () => source.events(), [] as (ExportEvent & { calendar?: string | null })[]);
  zip.add("calendar/events.ics", icsCalendar(events, now));
  zip.add("calendar/events.json", JSON.stringify(events, null, 2));
  counts.tasks = tasks.length;
  counts.events = events.length;

  // Profile and AI settings
  zip.add("profile/profile.json", JSON.stringify(await note("Profile", () => source.settings(), {}), null, 2));

  // Files, only when chosen
  if (options.attachments) {
    const files = await note("Files", () => source.files(), [] as SourceFile[]);
    const fileNames = new Set<string>();
    let filesDone = 0;
    onProgress({ stage: "Files", done: 0, total: files.length });
    for (const f of files) {
      stop();
      const bytes = await note(`A file (${f.id})`, () => source.file(f), null as Uint8Array | null);
      if (bytes) {
        const dot = f.name.lastIndexOf(".");
        const ext = dot > 0 && f.name.length - dot <= 8 ? f.name.slice(dot) : "";
        zip.add(uniquePath(fileNames, `files/${f.kind === "note" ? "notes" : "messages"}`, safeName(ext ? f.name.slice(0, dot) : f.name, "File"), ext), bytes);
        counts.files++;
      } else problems.push(`A file (${f.id}): not stored, so it could not be included.`);
      onProgress({ stage: "Files", done: ++filesDone, total: files.length });
    }
  }

  stop();
  if (problems.length > 0) zip.add("problems.txt", `Some things could not be included. Nothing here contains your content.\n\n${problems.join("\n")}\n`);
  zip.add("README.txt", readme(now, counts, options.attachments, problems.length));
  onProgress({ stage: "Finishing", done: 1, total: 1 });
  return zip.finish();
}

function readme(now: Date, c: Record<string, number>, withFiles: boolean, problems: number): string {
  return [
    "Your Konva data",
    `Made on ${now.toISOString().slice(0, 10)} in your browser. Your messages were opened with your own key on this device, so nothing readable passed through our servers.`,
    "",
    `Conversations: ${c.conversations} (${c.messages} messages), in conversations/, each as readable text and as JSON`,
    `Contacts: ${c.contacts}, in contacts/ as CSV and vCard`,
    `Notes: ${c.notes}, in notes/ as Markdown`,
    `Tasks: ${c.tasks}, in tasks/tasks.json`,
    `Calendar events: ${c.events}, in calendar/ as .ics and JSON`,
    "Your profile, About You and AI settings: profile/profile.json",
    withFiles ? `Files: ${c.files}, in files/` : "Files: not included. Download again with Include Files switched on to get them.",
    problems > 0 ? `\nSome things could not be included: see problems.txt.` : "",
    "",
  ].filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
}
