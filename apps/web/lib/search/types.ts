// The shapes shared by the search index, its worker and the screens. Documents are deliberately small: the index
// holds up to a hundred thousand of them in memory, so every field is a short name and optional when empty.

/** What a document is. Result groups follow this order. */
export const KINDS = ["thread", "message", "contact", "note", "event", "task", "file"] as const;
export type Kind = (typeof KINDS)[number];

/** One searchable thing. Never sent anywhere: it lives in the browser, in memory and encrypted on disk. */
export interface Doc {
  /** Unique across kinds: a one letter kind code and the row's id. */
  id: string;
  k: Kind;
  /** The row's own id (a thread's, a note's), used to open it. */
  r: string;
  /** The conversation it belongs to (messages and files). */
  th?: string;
  /** For a file, the message it came with. */
  mi?: string;
  /** Title: a subject, a name, a file name. */
  t: string;
  /** Body text, cut to a per kind length so memory stays bounded. */
  x: string;
  /** Who it is from (names and addresses). For a conversation, everyone in it. */
  fr?: string;
  /** Who it went to. For a conversation, everyone in it. */
  to?: string;
  /** When it happened, in ms since 1970 (sent, edited, starting, due). 0 when it has no time. */
  at: number;
  /** Has an attachment. */
  a?: 1;
  /** Conversation is unread. */
  u?: 1;
  /** Sent by the person themselves. */
  me?: 1;
  /** Conversation is in the provider's bin: it and everything in it is left out of results. */
  tr?: 1;
  /** Task is done. */
  d?: 1;
}

/** The query after parsing: words, quoted phrases and operators, all folded (see fold.ts). */
export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  from: string[];
  to: string[];
  hasAttachment: boolean;
  unread: boolean;
  /** Start of the day, in ms: only things before it. */
  before?: number;
  /** Start of the day, in ms: only things on or after it. */
  after?: number;
  /** An operator was used, even when its value was unusable. */
  hasOperators: boolean;
  /** Nothing to search for: no words and no operators. */
  empty: boolean;
}

export interface Hit {
  doc: Doc;
  score: number;
  /** A stretch of the text around the first match, for messages, notes and the like. */
  snippet?: string;
}

/** Hits per kind, best first, with how many matched in all (more than were returned when capped). */
export type SearchResult = Record<Kind, { hits: Hit[]; total: number }>;

/** How far the first build has got: indexed of expected. Total is null until the counts are known. */
export interface IndexProgress {
  ready: boolean;
  indexed: number;
  total: number | null;
  /** Still paging through history. */
  building: boolean;
  /** Goes up when documents were added, changed or removed, so an open search can run again. */
  rev: number;
}

/** Text kept per document, by kind (characters). Bounds memory; the start of a long note or email is what people search. */
export const TEXT_CAP: Record<Kind, number> = { thread: 500, message: 600, contact: 300, note: 4000, event: 1000, task: 600, file: 400 };
