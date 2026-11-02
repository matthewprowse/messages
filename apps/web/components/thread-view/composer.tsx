// The reply box at the bottom of a conversation: the text, drafts and AI edits, files, voice, and Send. What it types and
// asks is remembered per conversation (composer-memory.ts); the AI buttons are in draft-bar.tsx and its dialogs in ask-dialogs.tsx.

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import type { DraftPhase } from "@/lib/store";
import type { Decision, Draft, Message, Thread } from "@/lib/types";
import { attachProvider, type OutboxUpload } from "@/lib/outbox-files";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { providerLabel } from "@/components/primitives";
import { GuidedChoices } from "@/components/guided-choices";
import { ReplyHeader, useReplyAll, useReplyFrom } from "@/components/reply-header";
import { AttachButton, AttachmentChips, useOutboxFiles } from "@/components/outbox-attachments";
import { RecordButton, RecordingActions, RecordingStatus, SpeakButton, useVoiceRecorder } from "@/components/voice-recorder";
import { TemplatePicker } from "@/components/template-picker";
import { InstagramReplyNotice, useInstagramReplyClosed } from "@/components/instagram-window";

import { DraftBar } from "@/components/thread-view/draft-bar";
import { beforeAsk, typedText } from "@/components/thread-view/composer-memory";

// The ask dialogs open on a click, so their code loads on its own the first time one is wanted.
const AskDialogs = dynamic(() => import("@/components/thread-view/ask-dialogs").then((m) => m.AskDialogs), { ssr: false });

export function Composer({ thread, msgs, phase, onDraft, onDiscardDraft, onSend }: { thread: Thread; msgs: Message[]; phase?: DraftPhase; onDraft: (tone?: Draft["tone"], instruction?: string, decision?: Decision, source?: string, audio?: Blob) => void; onDiscardDraft: () => void; onSend: (body: string, from?: string, files?: OutboxUpload[], copies?: { to: string[]; cc: string[] }) => Promise<boolean> }) {
  const replyFrom = useReplyFrom(thread, msgs);
  const replyAll = useReplyAll(thread, msgs, replyFrom);
  const [text, setText] = useState("");
  const [instruction, setInstruction] = useState("");
  const draft = thread.draft;
  const busy = !!phase;
  const ref = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef(thread.id);
  threadRef.current = thread.id;
  // Undo puts back what the box held once the draft is gone, instead of the empty box a discard leaves.
  const restoreRef = useRef<string | undefined>(undefined);
  // Your own text (or a draft you changed) can be lightly corrected by the AI without being rewritten.
  const editable = !busy && text.trim().length > 0 && text.trim() !== (draft?.body ?? "").trim();
  // Undo is offered for a draft you asked for over text that was there, until you change the draft.
  const before = beforeAsk.get(thread.id);
  const undoable = !busy && !!draft && !draft.auto && !!before && draft.id !== before.replacing && text === draft.body;

  // What the box last showed for this conversation and from which draft, so a pre-draft arriving while
  // you type is held back, and a run with nothing new (React runs it twice on mount in development)
  // leaves the box alone.
  const shownRef = useRef({ thread: "", text: "", draft: "", body: "" });
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    const same = shownRef.current.thread === thread.id;
    if (same && restoreRef.current === undefined && shownRef.current.draft === (draft?.id ?? "") && shownRef.current.body === (draft?.body ?? "")) return;
    const typing = same && textRef.current.trim() !== "" && textRef.current !== shownRef.current.text;
    if (draft?.auto && typing) return;
    // Back in a conversation, what you were typing there comes back instead of its draft. It still
    // counts as typing, so a pre-draft arriving does not replace it.
    const kept = same ? undefined : typedText.get(thread.id);
    const next = kept ?? restoreRef.current ?? draft?.body ?? "";
    restoreRef.current = undefined;
    shownRef.current = { thread: thread.id, text: kept === undefined ? next : draft?.body ?? "", draft: draft?.id ?? "", body: draft?.body ?? "" };
    setText(next);
  }, [thread.id, draft?.id, draft?.body, draft?.auto]);
  // What you asked for stays in the box with its draft, so another try or an adjustment keeps it.
  // A pre-draft has none, and arriving it leaves what you are typing there alone.
  const askedIn = useRef("");
  useEffect(() => {
    if (draft?.auto && askedIn.current === thread.id) return;
    askedIn.current = thread.id;
    setInstruction(draft?.instruction ?? "");
  }, [thread.id, draft?.id, draft?.instruction, draft?.auto]);
  const type = (value: string) => {
    setText(value);
    if (value.trim() && value !== (draft?.body ?? "")) typedText.set(thread.id, value);
    else typedText.delete(thread.id);
  };
  // Every request goes through here, so what the box held can come back with Undo.
  const ask = (tone?: Draft["tone"], said?: string, decision?: Decision, source?: string, audio?: Blob) => {
    if (text.trim()) beforeAsk.set(thread.id, { text, replacing: draft?.id });
    else beforeAsk.delete(thread.id);
    typedText.delete(thread.id);
    onDraft(tone, said, decision, source, audio);
  };
  const undo = () => {
    if (!before) return;
    beforeAsk.delete(thread.id);
    restoreRef.current = before.text;
    typedText.set(thread.id, before.text);
    onDiscardDraft();
  };
  const said = instruction.trim();
  // Draft and Edit Text each ask what you want first, in a dialog, so it is clear what they will do.
  const [asking, setAsking] = useState<"draft" | "edit" | null>(null);
  const [change, setChange] = useState("");
  // The ask dialog and its note belong to one conversation; they must not follow you to the next.
  useEffect(() => { setAsking(null); setChange(""); }, [thread.id]);
  const draftLabel = draft ? "New Draft" : thread.lastFromMe ? "Draft Follow-Up" : "Draft";
  const startDraft = () => {
    setAsking(null);
    ask(said ? "custom" : "default", said || undefined, draft?.decision);
  };
  const startEdit = () => {
    const note = change.trim();
    setAsking(null);
    setChange("");
    ask("edit", note || undefined, undefined, text);
  };
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "0px"; el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [text]);

  const [sending, setSending] = useState(false);
  // Files go up first, then the reply is queued with them. A failure keeps the text and the files.
  const files = useOutboxFiles(attachProvider(thread.provider), busy || sending);
  const clearFiles = files.clear;
  useEffect(() => { clearFiles(); }, [thread.id, clearFiles]);
  const voice = useVoiceRecorder(files, thread.id);
  // Speak: what you say becomes the draft's instruction. The newest ask() is used when the clip is done.
  const askRef = useRef(ask);
  askRef.current = ask;
  const speech = useVoiceRecorder(files, thread.id, (clip) => askRef.current("custom", undefined, thread.draft?.decision, undefined, clip));
  const recorder = voice.recording ? voice : speech.recording ? speech : undefined;
  const closed = useInstagramReplyClosed(thread, msgs);
  const canSend = (text.trim().length > 0 || files.items.length > 0) && !busy && !sending && !files.blocked && !replyAll.error && !recorder && !closed;
  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    const sentFrom = thread.id;
    let queued = false;
    try {
      const uploaded = await files.upload();
      if (!uploaded) return;
      queued = await onSend(text, replyFrom.chosen ?? undefined, uploaded, replyAll.copies);
    } catch {
      toast("Could not send. Your reply is still in the box.");
    } finally {
      setSending(false);
    }
    if (!queued) return;
    typedText.delete(sentFrom);
    beforeAsk.delete(sentFrom);
    // Only the box that sent is cleared: you may have moved to another conversation meanwhile.
    if (threadRef.current === sentFrom) { setText(""); setInstruction(""); files.clear(); replyAll.reset(); }
  };

  // Once opened, the dialogs stay mounted so closing one still animates.
  const askedOnce = useRef(false);
  if (asking) askedOnce.current = true;
  // The box still holds the AI's draft as written: marked, so you know to read it. Editing the text removes the mark.
  const untouchedDraft = !!draft && !recorder && phase !== "thinking" && text.trim() === draft.body.trim() && text.trim().length > 0;

  return (
    <div className="shrink-0 border-t bg-background p-3 md:px-4">
      <div className="mx-auto w-full max-w-2xl">
        {closed && <InstagramReplyNotice />}
        {!draft && !busy && <GuidedChoices thread={thread} msgs={msgs} disabled={busy} onPick={(decision) => ask("default", undefined, decision)} />}
        {!recorder && (
          <DraftBar
            busy={busy}
            hasText={!!text.trim()}
            editable={editable}
            undoable={undoable}
            hasDraft={!!draft}
            draftLabel={draftLabel}
            onAskDraft={() => setAsking("draft")}
            onFix={() => ask("edit", undefined, undefined, text)}
            onAskEdit={() => setAsking("edit")}
            onAdjust={(tone) => ask(tone, said || undefined, draft?.decision, text)}
            onUndo={undo}
            onDiscard={() => { beforeAsk.delete(thread.id); typedText.delete(thread.id); onDiscardDraft(); setText(""); }}
          />
        )}
        {/* While a draft is written the text box becomes a placeholder line. */}
        <div {...files.dropProps} className={cn("rounded-lg border bg-background/50 p-3 focus-within:ring-3 focus-within:ring-ring/30", files.dragging && "border-ring ring-3 ring-ring/30")}>
          <ReplyHeader thread={thread} msgs={msgs} reply={replyFrom} all={replyAll} />
          {untouchedDraft && <Badge variant="secondary" className="mb-2">AI Draft</Badge>}
          {recorder ? (
            <RecordingStatus voice={recorder} />
          ) : phase === "thinking" ? (
            // One line, the height of the empty text box, so the composer does not jump in size.
            <div className="flex h-5 items-center" aria-label="Drafting a reply">
              <Skeleton className="h-3 w-3/5" />
            </div>
          ) : (
            <Textarea
              ref={ref}
              value={text}
              readOnly={phase === "streaming"}
              onChange={(e) => type(e.target.value)}
              onPaste={files.onPaste}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
              placeholder="Message"
              rows={1}
              className="min-h-5 resize-none rounded-none border-0 bg-transparent p-0 text-base leading-5 md:text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          )}
          <div className="mt-3 empty:hidden"><AttachmentChips files={files} /></div>
          <div className="mt-6 flex items-center justify-between gap-3">
            {recorder ? <div /> : (
              <div className="flex items-center gap-2">
                <AttachButton files={files} />
                <SpeakButton voice={speech} disabled={busy} />
                <RecordButton files={files} voice={voice} />
                <TemplatePicker workspaceId={thread.workspaceId} disabled={busy} onInsert={(t) => type(text.trim() ? `${text.trimEnd()}\n\n${t}` : t)} />
              </div>
            )}
            {recorder
              ? <RecordingActions voice={recorder} done={recorder === speech ? "Draft" : "Stop"} />
              : <Button disabled={!canSend} onClick={submit}>Send via {providerLabel[thread.provider]}</Button>}
          </div>
        </div>
      </div>
      {(asking || askedOnce.current) && <AskDialogs
        asking={asking}
        onClose={() => setAsking(null)}
        busy={busy}
        hasDraft={!!draft}
        draftLabel={draftLabel}
        instruction={instruction}
        onInstruction={setInstruction}
        change={change}
        onChange={setChange}
        onStartDraft={startDraft}
        onStartEdit={startEdit}
        onRecordInstead={() => { setAsking(null); speech.start(); }}
      />}
    </div>
  );
}
