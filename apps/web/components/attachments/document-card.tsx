"use client";

// The document card on a file: a one-line chip for a tile, and the full card in the viewer with its facts, Read Document for
// a PDF or a picture named like a document that has none yet, and "Invoice due 30 Nov" as a task in one click (store createTask, the same queue as New Task).
// The card is made by the AI worker (apps/ai/ai/documents.py); the words here are plain text and never the file's own markup.

import { useMemo } from "react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { cardFacts, cardTaskForm, DOC_LABEL, looksLikeDocument, taskTitle, tileLine, type DocCard } from "@/lib/search/document-card";
import { TASK_PROVIDERS } from "@/lib/tasks";
import { useApp } from "@/lib/store";
import type { Attachment } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requestCard, type DocEntry } from "./document-store";

/** Only PDFs and pictures that are stored here can be read. */
export const canReadDocument = (a: Pick<Attachment, "kind" | "path">) => !!a.path && (a.kind === "pdf" || a.kind === "image");

/** The chip over the foot of a tile: the type and amount. Nothing for a file with no card. */
export function CardChip({ card }: { card: DocCard | undefined }) {
  if (!card) return null;
  return <Badge variant="secondary" title={card.summary} className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate">{tileLine(card)}</Badge>;
}

function AddTask({ card, fileName }: { card: DocCard; fileName: string }) {
  const { accounts, createTask } = useApp();
  const account = useMemo(() => accounts.find((a) => (TASK_PROVIDERS as readonly string[]).includes(a.provider) && a.status !== "disconnected"), [accounts]);
  const form = account ? cardTaskForm(card, account.id, fileName) : null;
  if (!card.due) return null;
  if (!form) return <p className="text-xs text-muted-foreground">Connect Microsoft To Do, Google Tasks or iCloud Reminders in Settings to make this a task.</p>;
  return (
    <Button variant="secondary" className="self-start" onClick={() => { createTask(form); track("feature_used", { feature: "document_task" }); toast(`Making a task: ${taskTitle(card)}.`); }}>
      Add as Task
    </Button>
  );
}

/** The card in the viewer, under the file's name. Shows nothing for a file that cannot be read. */
export function DocumentCardPanel({ attachment: a, entry }: { attachment: Attachment; entry: DocEntry | undefined }) {
  if (!canReadDocument(a) || !entry) return null;
  if (entry.state === "card") {
    const { card } = entry;
    return (
      <section aria-label="Document Card" className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
        <div className="flex items-center gap-2"><Badge variant="secondary">{DOC_LABEL[card.type]}</Badge><span className="min-w-0 flex-1 truncate font-medium">{card.counterparty || a.name}</span></div>
        <p className="text-muted-foreground">{card.summary}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {cardFacts(card).map((f) => (<div key={f.label} className="contents"><dt className="text-muted-foreground">{f.label}</dt><dd className="min-w-0 break-words">{f.value}</dd></div>))}
        </dl>
        <AddTask card={card} fileName={a.name} />
      </section>
    );
  }
  if (entry.state === "waiting")
    return <div role="status" className="flex flex-col gap-2 rounded-lg border p-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-full" /><span className="text-xs text-muted-foreground">Reading This Document</span></div>;
  // Only a file that may be a document is offered a read (or told it is not one): not every photo from a chat.
  if (!looksLikeDocument(a)) return null;
  if (entry.state === "none") return <p className="text-xs text-muted-foreground">This does not look like an invoice, contract or similar document.</p>;
  if (entry.state === "error")
    return <div className="flex items-center gap-3 text-sm"><span className="min-w-0 flex-1 text-muted-foreground">{entry.message}</span><Button variant="secondary" onClick={() => void requestCard(a.id)}>Retry</Button></div>;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="min-w-0 flex-1 text-muted-foreground">Find out what type of document this is, who it is with and when it is due.</span>
      <Button variant="secondary" onClick={() => { track("feature_used", { feature: "document_read" }); void requestCard(a.id); }}>Read Document</Button>
    </div>
  );
}
