// Document cards in the app: the card the AI worker keeps on a PDF or scanned document (apps/ai/ai/documents.py), read from
// its opened JSON, what it says on a tile and in the viewer, the filters on the Attachments page, the words it adds to the
// private search index, and the task "Invoice due 30 Nov" becomes. Pure: no network, no storage. Lives with search because
// the index builds file documents from it; the Attachments components import it from here.

import type { TaskForm } from "../tasks";

export const DOC_TYPES = ["invoice", "quote", "contract", "id", "statement", "proof_of_payment", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface DocCard {
  type: DocType;
  /** Who is on the other side of it from you; empty when the document does not say. */
  counterparty: string;
  amount: number | null;
  /** Three letter code; ZAR when the document shows rand. */
  currency: string;
  /** The day it is due, YYYY-MM-DD. */
  due: string | null;
  reference: string;
  summary: string;
}

export const DOC_LABEL: Record<DocType, string> = { invoice: "Invoice", quote: "Quote", contract: "Contract", id: "ID", statement: "Statement", proof_of_payment: "Proof of Payment", other: "Document" };

/** The Attachments page's document filter: a type, or Any Document. The labels are the plural the page shows. */
export const DOC_FILTERS: { key: "all" | DocType; label: string }[] = [
  { key: "all", label: "Any Document" },
  { key: "invoice", label: "Invoices" },
  { key: "contract", label: "Contracts" },
  { key: "proof_of_payment", label: "Proof of Payment" },
  { key: "quote", label: "Quotes" },
  { key: "statement", label: "Statements" },
  { key: "id", label: "IDs" },
];

/** A filter value from the address; anything unknown is Any Document. */
export const docFilterOf = (value: string | null | undefined): "all" | DocType => DOC_FILTERS.find((f) => f.key === value)?.key ?? "all";

/** Whether a file passes the document filter. A file with no card (not read, or not a document) passes only Any Document. */
export const matchesDocFilter = (card: Pick<DocCard, "type"> | null | undefined, filter: "all" | DocType): boolean => filter === "all" || card?.type === filter;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** attachments.doc_card, opened, as a card: null when it is missing or not in the expected shape. */
export function parseDocCard(json: string | null | undefined): DocCard | null {
  if (!json) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const type = DOC_TYPES.find((t) => t === raw.type);
  const summary = text(raw.summary, 200);
  if (!type || !summary) return null;
  const amount = typeof raw.amount === "number" && Number.isFinite(raw.amount) && raw.amount > 0 ? raw.amount : null;
  const currency = typeof raw.currency === "string" && /^[A-Za-z]{3}$/.test(raw.currency) ? raw.currency.toUpperCase() : "ZAR";
  const due = typeof raw.due === "string" && validDay(raw.due) ? raw.due : null;
  return { type, counterparty: text(raw.counterparty, 100), amount, currency, due, reference: text(raw.reference, 60), summary };
}

function validDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "30 Nov", or "30 Nov 2027" when it is not in the year of `now`. */
export function dueLabel(due: string, now: Date = new Date()): string {
  const [y, m, d] = due.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${y === now.getFullYear() ? "" : ` ${y}`}`;
}

/** "R 12 500.50" for rand, "USD 1 299.00" otherwise: spaces between thousands, two decimals. Written here, not by Intl, so it reads the same everywhere. */
export function amountLabel(amount: number, currency: string): string {
  const [whole, cents] = amount.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${currency === "ZAR" ? "R" : currency} ${grouped}.${cents}`;
}

/** The short line on a tile: "Invoice, R 1 250.00", or just the type when there is no amount. */
export function tileLine(card: DocCard): string {
  return [DOC_LABEL[card.type], card.amount !== null ? amountLabel(card.amount, card.currency) : ""].filter(Boolean).join(", ");
}

/** The facts the viewer lists under the summary, label then value, only those the document gave. */
export function cardFacts(card: DocCard, now: Date = new Date()): { label: string; value: string }[] {
  return [
    card.counterparty && { label: "With", value: card.counterparty },
    card.amount !== null && { label: "Amount", value: amountLabel(card.amount, card.currency) },
    card.due && { label: "Due", value: dueLabel(card.due, now) },
    card.reference && { label: "Reference", value: card.reference },
  ].filter((f): f is { label: string; value: string } => !!f);
}

// Words a person might type for a type that the type's own name does not contain.
const SEARCH_WORDS: Record<DocType, string> = { invoice: "invoice bill", quote: "quote quotation estimate", contract: "contract agreement", id: "id identity document", statement: "statement", proof_of_payment: "proof of payment receipt", other: "document" };

/**
 * The words a card adds to the search index entry of its file, so "invoice from Sipho" finds it: the type and its
 * everyday names, who it is with, the reference, the amount as written and the summary. Empty without a card.
 */
export function cardSearchText(card: DocCard | null | undefined): string {
  if (!card) return "";
  return [SEARCH_WORDS[card.type], card.counterparty, card.reference, card.amount !== null ? amountLabel(card.amount, card.currency) : "", card.summary].filter(Boolean).join(" ");
}

/** The title of the task a card can become: "Invoice due 30 Nov", or the type and "to review" when it has no date. */
export function taskTitle(card: DocCard, now: Date = new Date()): string {
  return card.due ? `${DOC_LABEL[card.type]} due ${dueLabel(card.due, now)}` : `Review ${DOC_LABEL[card.type]}`;
}

/** The task form for a card in the given task account. Only a dated card is offered one; the date is the due date. */
export function cardTaskForm(card: DocCard, accountId: string, fileName: string, now: Date = new Date()): TaskForm | null {
  if (!card.due) return null;
  const notes = [card.counterparty, card.reference, card.amount !== null ? amountLabel(card.amount, card.currency) : "", fileName ? `File: ${fileName}` : ""].filter(Boolean).join(", ");
  return { title: taskTitle(card, now), notes, accountId, date: card.due, time: "", priority: 0 };
}
