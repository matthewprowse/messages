// The in-memory search index: documents in, ranked groups of hits out. Pure (no storage, no crypto, no DOM), so the
// worker, the main-thread fallback and the tests all run the same code.
//
// Matching is substring on folded text, every word in any order, which is what people expect as they type. Memory is
// bounded three ways: text is cut per kind when documents are built (types.ts TEXT_CAP), messages and files are capped
// (MAX_MESSAGES, MAX_FILES; the oldest go first), and each document keeps one folded copy of its text, not a word list.

import { fold, startsWord } from "./fold";
import { KINDS, type Doc, type Kind, type ParsedQuery, type SearchResult } from "./types";

/** The most messages held. A very large mailbox keeps the newest; older ones stay findable in their provider's own search. */
export const MAX_MESSAGES = 150_000;
/** The most file names held. */
export const MAX_FILES = 100_000;

const DAY_MS = 86_400_000;
const SNIPPET_BEFORE = 30;
const SNIPPET_LENGTH = 150;

interface Entry {
  d: Doc;
  /** Folded title, text, sender and recipients, made once when the document is added. */
  ft: string;
  fx: string;
  ffr: string;
  fto: string;
}

const CODE: Record<Kind, string> = { thread: "c", message: "m", contact: "p", note: "n", event: "e", task: "t", file: "f" };

/** The id a document of this kind and row gets. */
export function docId(kind: Kind, ref: string): string {
  return `${CODE[kind]}${ref}`;
}

const emptyResult = (): SearchResult => Object.fromEntries(KINDS.map((k) => [k, { hits: [], total: 0 }])) as unknown as SearchResult;

export class SearchEngine {
  private entries = new Map<string, Entry>();
  private counts = new Map<Kind, number>();
  private unreadThreads = new Set<string>();
  private trashedThreads = new Set<string>();
  // Conversations holding a message with a file, rebuilt when a search needs it after a change.
  private attached: Set<string> | null = null;

  get size() { return this.entries.size; }
  count(kind: Kind) { return this.counts.get(kind) ?? 0; }
  has(id: string) { return this.entries.has(id); }
  get(id: string) { return this.entries.get(id)?.d; }
  /** Every document, for saving. */
  *docs(): IterableIterator<Doc> { for (const e of this.entries.values()) yield e.d; }

  /** Adds or replaces documents. Returns the ids dropped to stay inside the caps, oldest first. */
  upsert(docs: Doc[]): string[] {
    for (const d of docs) {
      const old = this.entries.get(d.id);
      if (old) this.untrack(old.d);
      else this.counts.set(d.k, this.count(d.k) + 1);
      this.entries.set(d.id, { d, ft: fold(d.t), fx: fold(d.x), ffr: d.fr ? fold(d.fr) : "", fto: d.to ? fold(d.to) : "" });
      this.track(d);
    }
    this.attached = null;
    return [...this.evict("message", MAX_MESSAGES), ...this.evict("file", MAX_FILES)];
  }

  remove(ids: string[]) {
    for (const id of ids) {
      const e = this.entries.get(id);
      if (!e) continue;
      this.untrack(e.d);
      this.entries.delete(id);
      this.counts.set(e.d.k, this.count(e.d.k) - 1);
    }
    this.attached = null;
  }

  /** Removes messages by row id, with the file documents that came with them. Returns every id removed. */
  removeMessages(refs: string[]): string[] {
    const gone = new Set(refs);
    const ids = [...this.entries.values()].filter((e) => (e.d.k === "message" && gone.has(e.d.r)) || (e.d.k === "file" && e.d.mi && gone.has(e.d.mi))).map((e) => e.d.id);
    this.remove(ids);
    return ids;
  }

  /** When each document of a kind last changed, by row id: lets a loader skip rows it already holds. */
  stamps(kind: Kind): [string, number][] {
    const out: [string, number][] = [];
    for (const e of this.entries.values()) if (e.d.k === kind) out.push([e.d.r, e.d.at]);
    return out;
  }

  private track(d: Doc) {
    if (d.k !== "thread") return;
    if (d.u) this.unreadThreads.add(d.r);
    if (d.tr) this.trashedThreads.add(d.r);
  }

  private untrack(d: Doc) {
    if (d.k !== "thread") return;
    this.unreadThreads.delete(d.r);
    this.trashedThreads.delete(d.r);
  }

  private evict(kind: Kind, cap: number): string[] {
    const over = this.count(kind) - cap;
    if (over <= 0) return [];
    // A little extra, so the next arrival does not trigger another sort.
    const drop = over + Math.ceil(cap / 20);
    const oldest = [...this.entries.values()].filter((e) => e.d.k === kind).sort((a, b) => a.d.at - b.d.at).slice(0, drop).map((e) => e.d.id);
    this.remove(oldest);
    return oldest;
  }

  private attachedThreads(): Set<string> {
    if (!this.attached) {
      this.attached = new Set();
      for (const e of this.entries.values()) if ((e.d.k === "message" && e.d.a) || e.d.k === "file") if (e.d.th) this.attached.add(e.d.th);
    }
    return this.attached;
  }

  /** Whether a document passes the operators and the bin. Words are scored separately. */
  private allowed(e: Entry, q: ParsedQuery, attached: Set<string> | null): boolean {
    const d = e.d;
    if (d.tr || (d.th && this.trashedThreads.has(d.th))) return false;
    // These operators are about conversations, messages and their files; they leave out contacts, notes and the rest.
    const mail = d.k === "thread" || d.k === "message" || d.k === "file";
    if ((q.from.length || q.to.length || q.unread || q.hasAttachment) && !mail) return false;
    if (q.unread && !(d.k === "thread" ? d.u : this.unreadThreads.has(d.th ?? ""))) return false;
    if (q.hasAttachment && !(d.k === "thread" ? attached!.has(d.r) : d.k === "file" || d.a)) return false;
    for (const f of q.from) if (!(f === "me" ? d.me : e.ffr.includes(f))) return false;
    for (const t of q.to) if (!(t === "me" ? d.k === "message" && !d.me : e.fto.includes(t))) return false;
    if (q.before !== undefined && !(d.at > 0 && d.at < q.before)) return false;
    if (q.after !== undefined && !(d.at > 0 && d.at >= q.after)) return false;
    return true;
  }

  /** Words and phrases: -1 when one is missing, else a score. Title beats people beats text; the start of a word beats the middle. */
  private score(e: Entry, q: ParsedQuery, now: number): number {
    let s = 0;
    for (const term of q.terms) {
      let at = e.ft.indexOf(term);
      if (at >= 0) {
        s += 10 + (startsWord(e.ft, at) ? 6 : 0) + (e.ft === term ? 4 : 0);
        continue;
      }
      if (e.ffr.includes(term) || e.fto.includes(term)) { s += 5; continue; }
      at = e.fx.indexOf(term);
      if (at < 0) return -1;
      s += 2 + (startsWord(e.fx, at) ? 1 : 0);
    }
    for (const phrase of q.phrases) {
      if (e.ft.includes(phrase) || e.fx.includes(phrase)) s += 8;
      else if (e.ffr.includes(phrase) || e.fto.includes(phrase)) s += 4;
      else return -1;
    }
    // Newer things first among equals, fading over about half a year.
    const age = Math.max(0, now - e.d.at) / DAY_MS;
    return s + (e.d.at > 0 ? 4 * Math.exp(-age / 200) : 0);
  }

  /** The best hits per kind. `limits` is how many to return for each; kinds left out return none (their total is still counted). */
  search(q: ParsedQuery, limits: Partial<Record<Kind, number>>, now: number = Date.now()): SearchResult {
    const out = emptyResult();
    if (q.empty) return out;
    const attached = q.hasAttachment ? this.attachedThreads() : null;
    const top: Record<Kind, { e: Entry; s: number }[]> = Object.fromEntries(KINDS.map((k) => [k, []])) as never;
    for (const e of this.entries.values()) {
      if (!this.allowed(e, q, attached)) continue;
      const s = this.score(e, q, now);
      if (s < 0) continue;
      const kind = e.d.k;
      out[kind].total++;
      const cap = limits[kind] ?? 0;
      if (cap === 0) continue;
      const list = top[kind];
      if (list.length >= cap && s <= list[list.length - 1].s) continue;
      // Sorted insert, best first; a tie goes to the newer document.
      let i = list.length;
      while (i > 0 && (list[i - 1].s < s || (list[i - 1].s === s && list[i - 1].e.d.at < e.d.at))) i--;
      list.splice(i, 0, { e, s });
      if (list.length > cap) list.pop();
    }
    for (const k of KINDS) out[k].hits = top[k].map(({ e, s }) => ({ doc: e.d, score: s, snippet: snippetOf(e, q) }));
    return out;
  }

  /** Every conversation that matches, directly or through one of its messages or files, for filtering the Inbox list. */
  threadIds(q: ParsedQuery, cap = 5000): Set<string> {
    const found = new Set<string>();
    if (q.empty) return found;
    const now = Date.now();
    const attached = q.hasAttachment ? this.attachedThreads() : null;
    for (const e of this.entries.values()) {
      const k = e.d.k;
      if (k !== "thread" && k !== "message" && k !== "file") continue;
      const id = k === "thread" ? e.d.r : e.d.th;
      if (!id || found.has(id) || !this.allowed(e, q, attached) || this.score(e, q, now) < 0) continue;
      found.add(id);
      if (found.size >= cap) break;
    }
    return found;
  }
}

/** A stretch of the text around the first word found in it, or the start of the text when the match was in the title. */
function snippetOf(e: Entry, q: ParsedQuery): string | undefined {
  const text = e.d.x;
  if (!text) return undefined;
  for (const term of [...q.terms, ...q.phrases]) {
    const at = e.fx.indexOf(term);
    if (at < 0) continue;
    const start = Math.max(0, at - SNIPPET_BEFORE);
    return `${start > 0 ? "…" : ""}${text.slice(start, start + SNIPPET_LENGTH)}`;
  }
  return text.slice(0, SNIPPET_LENGTH);
}

