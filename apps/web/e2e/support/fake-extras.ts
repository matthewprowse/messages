// The rest of the made-up data: labels, tasks, calendar events, today's brief and the promises the AI found. Times are
// relative to the moment of seeding (a day offset and a clock time in the browser's zone, Africa/Johannesburg in the
// Playwright config), so "today" is always today. seed-extras.ts writes these as the workers do. Everything here is invented.

export const LABELS = [
  { name: "Clients", color: "blue" },
  { name: "Personal", color: "green" },
] as const;

export interface FakeTask {
  title: string;
  list: string;
  /** Days from today the task is due. */
  dueDays: number;
  /** "HH:MM" local, or undefined for an all day task. */
  at?: string;
}

export const TASKS: FakeTask[] = [
  { title: "Send the kitchen quote to Ava", list: "Work", dueDays: 0, at: "17:00" },
  { title: "Renew the parking permit", list: "Personal", dueDays: -1 },
  { title: "Book the lodge for the offsite", list: "Work", dueDays: 2 },
];

export interface FakeEvent {
  title: string;
  calendar: string;
  dueDays: number;
  /** "HH:MM" local start, or undefined for an all day event. */
  at?: string;
  minutes?: number;
  location?: string;
}

export const EVENTS: FakeEvent[] = [
  { title: "Team Planning Day", calendar: "Work", dueDays: 0 },
  { title: "Client Call With Ben", calendar: "Work", dueDays: 1, at: "09:00", minutes: 30, location: "Video call" },
  { title: "Lease Walkthrough", calendar: "Work", dueDays: 2, at: "14:00", minutes: 60, location: "Unit 4B" },
  { title: "Wedding Prep Day", calendar: "Personal", dueDays: 4 },
];

/** Today's brief as the AI worker leaves it: the script alone (the morning brief is only spoken when someone listens). */
export const BRIEF_SCRIPT = "Good morning. You have two conversations that need a reply: Ava is waiting on the kitchen quote, and Ben needs an answer about the lease by Friday. Your calendar has a team planning day today.";

export interface FakePromise {
  /** The conversation it came from (a key in CONVERSATIONS). */
  thread: string;
  owner: "me" | "them";
  text: string;
  /** Days from today it is due: negative is overdue. */
  dueDays: number;
}

// Yours due within two days and theirs past their day show on the Summary; the last one is too far off to show.
export const PROMISES: FakePromise[] = [
  { thread: "kitchen", owner: "me", text: "Send the full quote by Thursday", dueDays: 1 },
  { thread: "lease", owner: "me", text: "Confirm the lease renewal", dueDays: 0 },
  { thread: "tax", owner: "them", text: "Send the October receipts", dueDays: -2 },
  { thread: "website", owner: "me", text: "Review the new contact page", dueDays: 9 },
];

/** Sent replies, for Replied Today: the conversation and the text. Rows in the outbox the worker has already sent. */
export const SENT_REPLIES = [
  { thread: "invoice", body: "The corrected invoice is attached." },
  { thread: "website", body: "I have made the button larger." },
] as const;
