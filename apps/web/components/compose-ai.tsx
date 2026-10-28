"use client";

// AI drafting in New Email and New WhatsApp: type or say what the message should say, and the AI writes
// it in your voice (an email with its subject). Edit Text corrects what you wrote yourself. Undo puts back
// what the fields held. The draft has no conversation yet; its id goes out with the message, so learning
// can read what you changed once the conversation is filed.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecordingActions, RecordingStatus, SpeakButton, useVoiceRecorder } from "@/components/voice-recorder";

export interface Composed {
  body: string;
  subject?: string;
  /** The draft the fields now come from, or undefined after Undo. */
  draftId?: string;
}

export function ComposeAi({ open, sent, disabled, accountId, channel, contactId, body, subject, onApply }: {
  open: boolean;
  /** The message went out: its draft is kept, for learning. */
  sent: boolean;
  disabled?: boolean;
  accountId?: string;
  channel: "email" | "whatsapp";
  contactId?: string;
  body: string;
  subject?: string;
  onApply: (next: Composed) => void;
}) {
  const { generateComposeDraft, composeDrafts, discardComposeDraft } = useApp();
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<{ id: string; before: Composed; edit: boolean } | null>(null);
  const [shown, setShown] = useState<{ id: string; before: Composed; body: string } | null>(null);
  const waiting = asked ? composeDrafts[asked.id] : undefined;
  const busy = waiting?.status === "pending";

  // A fresh start each time the dialog opens. A draft not sent is thrown away when it closes.
  const keep = useRef({ shown, sent });
  keep.current = { shown, sent };
  useEffect(() => {
    if (open) { setInstruction(""); setError(null); setAsked(null); setShown(null); return; }
    const { shown: last, sent: went } = keep.current;
    if (last && !went) discardComposeDraft(last.id);
  }, [open, discardComposeDraft]);

  // The answer arrives in composeDrafts: it replaces the fields, and what they held is kept for Undo.
  useEffect(() => {
    if (!asked || !waiting || waiting.status === "pending") return;
    if (waiting.status === "failed") { setError(waiting.error ?? "The draft could not be written."); setAsked(null); return; }
    if (shown) discardComposeDraft(shown.id, asked.edit ? "revised" : "discarded"); // an edit kept working on it
    const next = waiting.body ?? "";
    onApply({ body: next, subject: channel === "email" && waiting.subject ? waiting.subject : asked.before.subject, draftId: asked.id });
    if (waiting.instruction) setInstruction(waiting.instruction); // what you said, written down
    setShown({ id: asked.id, before: asked.before, body: next });
    setAsked(null);
  }, [asked, waiting, shown, channel, onApply, discardComposeDraft]);

  const ask = async (request: { instruction?: string; audio?: Blob; tone?: "edit"; source?: string }) => {
    if (!accountId) return;
    setError(null);
    const before = { body, subject, draftId: shown?.id };
    const id = await generateComposeDraft({ accountId, channel, contactId, ...request });
    if (id) setAsked({ id, before, edit: request.tone === "edit" });
  };
  const said = instruction.trim();
  const draft = () => { if (said && !busy) void ask({ instruction: said }); };

  const askRef = useRef(ask);
  askRef.current = ask;
  const files = useMemo(() => ({ addVoiceNote: () => undefined, notify: setError }), []);
  const speech = useVoiceRecorder(files, open ? "compose" : "closed", (clip) => void askRef.current({ audio: clip }));

  const editable = !busy && body.trim().length > 0 && body !== shown?.body;
  const undoable = !busy && !!shown && body === shown.body;
  const undo = () => {
    if (!shown) return;
    discardComposeDraft(shown.id);
    onApply({ ...shown.before, draftId: undefined });
    setShown(null);
  };
  const off = disabled || !accountId;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {speech.recording ? (
          <>
            <div className="min-w-48 flex-1"><RecordingStatus voice={speech} /></div>
            <RecordingActions voice={speech} done="Draft" />
          </>
        ) : (
          <>
            <Input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              // Enter drafts; it must never reach the form, which would send the message.
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); draft(); } }}
              placeholder="What To Say"
              aria-label="What To Say"
              disabled={off || busy}
              className="h-8 min-w-48 flex-1"
            />
            <SpeakButton voice={speech} disabled={off || busy} />
            <Button type="button" variant="secondary" disabled={off || busy || !said} onClick={draft}>{busy ? "Drafting" : "Draft"}</Button>
            {editable && <Button type="button" variant="secondary" disabled={off} onClick={() => void ask({ tone: "edit", source: body })}>Edit Text</Button>}
            {undoable && <Button type="button" variant="ghost" onClick={undo}>Undo</Button>}
          </>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
