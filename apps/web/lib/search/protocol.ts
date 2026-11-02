// The messages between the page and the search worker. Every request gets one reply with the same id.

import type { UserKeys } from "@messages/crypto";
import type { Doc, Kind, ParsedQuery, SearchResult } from "./types";

export interface Counts {
  docs: number;
  messages: number;
  files: number;
}

export type Request =
  /** Opens the stored index with the user's keys. keys are the non-extractable WebCrypto keys, which can cross to a worker. */
  | { t: "init"; keys: UserKeys; userId: string }
  | { t: "upsert"; docs: Doc[] }
  | { t: "remove"; ids: string[] }
  /** Removes messages by row id along with their files (a deleted message). */
  | { t: "removeMessages"; refs: string[] }
  | { t: "search"; q: ParsedQuery; limits: Partial<Record<Kind, number>> }
  | { t: "threads"; q: ParsedQuery; cap?: number }
  /** Which of these document ids are already held. */
  | { t: "known"; ids: string[] }
  | { t: "stamps"; kind: Kind }
  /** Saves the small record of where loading got to; it is sealed with the shards. */
  | { t: "meta"; data: unknown }
  | { t: "flush" }
  /** Forgets everything, in memory and on disk (sign-out). */
  | { t: "clear" };

export interface Envelope {
  id: number;
  req: Request;
}

export type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false };

export interface InitReply {
  counts: Counts;
  /** What was stored could not be opened with this key and was cleared: the index starts again. */
  rebuilt: boolean;
  /** The record saved with `meta`, or null. */
  meta: unknown;
}

export type { SearchResult };
