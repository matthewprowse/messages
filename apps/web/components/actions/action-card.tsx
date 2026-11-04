"use client";

// The Action Card under a draft: one next step the AI proposed, what Approve will do, its arguments (editable) and one Approve
// button. Approve only calls the existing paths: New Event (opened with the chosen time and the conversation's people, still
// saved there), the task queue, the reply box's attach, and the template insert. Nothing happens without the click, and
// Dismiss only removes the card.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { loadEvents } from "@/lib/calendar";
import { slotButton, type Busy } from "@/lib/choices";
import { scheduleDefaults } from "@/lib/schedule";
import { TASK_PROVIDERS } from "@/lib/tasks";
import { fillVariables, type TemplateVars } from "@/lib/template-vars";
import { useUserTemplates } from "@/lib/use-user-templates";
import { acquireNoteFile, rememberNoteMime, mimeFor } from "@/lib/signed-urls";
import { track } from "@/lib/analytics";
import { addBelow } from "@/lib/suggest-times";
import { attachmentIn, describe, eventStart, KIND_LABEL, meetingSlots, pendingFor, slotsText, taskFormFor, type ActionArgs, type ProposedAction } from "@/lib/action-cards";
import type { Message, Thread } from "@/lib/types";
import type { OutboxFiles } from "@/components/outbox-attachments";
import { NewEventDialog } from "@/components/new-event-dialog";
import { useActions } from "@/components/actions/use-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const WEEK_MS = 8 * 24 * 60 * 60_000; // a day more than freeSlots looks ahead, as in Suggest Times

interface CardProps {
  action: ProposedAction;
  thread: Thread;
  msgs: Message[];
  vars: TemplateVars;
  files: OutboxFiles;
  text: string;
  /** Replaces the reply box's text. */
  onText: (value: string) => void;
  onDone: (status: "approved" | "dismissed") => void;
}

function Card({ action, thread, msgs, vars, files, text, onText, onDone }: CardProps) {
  const { accounts, contacts, createTask } = useApp();
  const templates = useUserTemplates().items;
  const [args, setArgs] = useState<ActionArgs>(action.args);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<Busy[] | null>(null);
  const [pick, setPick] = useState(0);
  const [eventOpen, setEventOpen] = useState(false);
  const meeting = args.kind === "book_meeting";
  useEffect(() => {
    if (!meeting) return;
    const now = new Date();
    void loadEvents(now, new Date(now.getTime() + WEEK_MS)).then(setEvents).catch(() => setEvents([]));
  }, [meeting]);
  const minutes = args.kind === "book_meeting" ? args.minutes : 60;
  const slots = useMemo(() => (events ? meetingSlots(events, minutes, new Date()) : []), [events, minutes]);
  const defaults = useMemo(() => scheduleDefaults(thread, contacts), [thread, contacts]);
  const taskAccount = accounts.find((a) => (TASK_PROVIDERS as readonly string[]).includes(a.provider) && a.status !== "disconnected");
  const template = args.kind === "use_template" ? templates.find((t) => t.id === args.templateId) : undefined;
  const attachment = args.kind === "attach_file" ? attachmentIn(msgs, args.attachmentId) : null;

  // What cannot be done is said on the card instead of leaving a dead button.
  const blocked =
    args.kind === "create_task" ? (taskAccount ? "" : "Connect a task list in Settings first.")
    : args.kind === "attach_file" ? (attachment ? "" : "This file is no longer available here.")
    : args.kind === "use_template" ? (template ? "" : "This template no longer exists.")
    : events && slots.length === 0 ? "No free times in the next week." : "";

  const approve = async () => {
    setBusy(true);
    try {
      if (args.kind === "book_meeting") {
        // The draft gets the three times; New Event opens on the first one (or the one picked) and is saved there.
        onText(addBelow(text, slotsText(slots)));
        setEventOpen(true);
        return;
      }
      if (args.kind === "create_task") createTask(taskFormFor(args, taskAccount!.id));
      else if (args.kind === "use_template") onText(addBelow(text, fillVariables(template!.body, vars)));
      else if (attachment) {
        rememberNoteMime(attachment.path!, mimeFor({ name: attachment.name, kind: attachment.kind }));
        const opened = await acquireNoteFile(attachment.path!).promise;
        if (!opened || opened.tooLarge) return void toast("Could not open that file.");
        const blob = await (await fetch(opened.url)).blob();
        files.add([new File([blob], attachment.name, { type: blob.type || mimeFor({ name: attachment.name, kind: attachment.kind }) })]);
      }
      track("feature_used", { feature: `action_${args.kind}` });
      onDone("approved");
    } catch {
      toast("Could not do that. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const first = slots[pick] ?? slots[0];
  const start = first ? eventStart(first) : undefined;
  return (
    <div className="mb-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="font-medium">{KIND_LABEL[action.args.kind]}</div>
      <p className="mt-1 text-muted-foreground">{describe(args)}</p>
      {(args.kind === "book_meeting" || args.kind === "create_task") && (
        <Input className="mt-2 h-8" aria-label="Title" maxLength={200} value={args.title} onChange={(e) => setArgs({ ...args, title: e.target.value })} />
      )}
      {args.kind === "create_task" && (
        <Input className="mt-2 h-8 w-44" type="date" aria-label="Due Date" value={args.due ?? ""} onChange={(e) => setArgs({ ...args, due: e.target.value || null })} />
      )}
      {args.kind === "book_meeting" && slots.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Meeting Time">
          {slots.map((s, i) => <Button key={s.toISOString()} type="button" variant={i === pick ? "secondary" : "outline"} role="radio" aria-checked={i === pick} onClick={() => setPick(i)}>{slotButton(s)}</Button>)}
        </div>
      )}
      {args.kind === "attach_file" && <p className="mt-2 truncate">{args.name}</p>}
      {args.kind === "use_template" && <p className="mt-2 truncate">{args.title}</p>}
      {blocked && <p className="mt-2 text-muted-foreground">{blocked}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="button" disabled={busy || !!blocked || (args.kind === "book_meeting" && !events) || (args.kind !== "attach_file" && args.kind !== "use_template" && !args.title.trim())} onClick={() => void approve()}>Approve</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => onDone("dismissed")}>Dismiss</Button>
      </div>
      {args.kind === "book_meeting" && (
        <NewEventDialog
          open={eventOpen}
          onOpenChange={(o) => { setEventOpen(o); if (!o) onDone("approved"); }}
          title={args.title}
          guests={defaults.guests}
          day={start?.day}
          time={start?.time}
        />
      )}
    </div>
  );
}

/**
 * The AI's waiting proposals for the draft in the box, as cards. text and onText are the reply box's, so a template or the
 * meeting times land in it; files is its attachment hook.
 */
export function ActionCards({ thread, msgs, draftId, vars, files, text, onText }: { thread: Thread; msgs: Message[]; draftId: string | undefined; vars: TemplateVars; files: OutboxFiles; text: string; onText: (value: string) => void }) {
  const { items, resolve } = useActions(thread.id);
  return (
    <>
      {pendingFor(items, draftId).map((a) => <Card key={a.id} action={a} thread={thread} msgs={msgs} vars={vars} files={files} text={text} onText={onText} onDone={(s) => void resolve(a.id, s)} />)}
    </>
  );
}
