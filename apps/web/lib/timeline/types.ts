// What one entry of a client's timeline is, whatever it came from. Every loader maps its rows to a TimelineItem so the merge,
// the filters and the day grouping know nothing about messages, meetings or promises. Pure types and constants.

/** The kinds of entry, in the order the filter shows them. */
export const TIMELINE_TYPES = ["message", "meeting", "note", "promise", "task", "document", "lead"] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];

/** The plural the type filter shows. */
export const TYPE_LABEL: Record<TimelineType, string> = {
  message: "Messages", meeting: "Meetings", note: "Notes", promise: "Promises", task: "Tasks", document: "Documents", lead: "Leads",
};

/** The kinds of thing a matter can hold, as a key prefix: "thread:<id>". */
export type RefKind = "thread" | "note" | "attachment" | "meeting";

export interface TimelineItem {
  /** Unique across types, such as "message:<id>". */
  key: string;
  type: TimelineType;
  /** When it happened (ISO). The merge sorts on this. */
  at: string;
  title: string;
  /** A second line: a message's first words, a meeting's summary, a document's card. */
  detail?: string;
  /** In-app page that holds the source. Absent when the source has no page of its own. */
  href?: string;
  /** For a message: the channel of its conversation, which picks the icon. */
  channel?: string;
  /** For a message: sent by you. */
  outgoing?: boolean;
  /** The things a matter can hold that this entry belongs to. A matter that holds any of them holds the entry. */
  refs: string[];
}

/** The key a matter link uses for one item. */
export const refKey = (kind: RefKind, id: string) => `${kind}:${id}`;
