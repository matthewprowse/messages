// The row of AI controls above the reply box: a "What Should This Say?" field with Draft (Enter drafts in one step), one Edit With AI
// menu (fix, edit, shorter, formal, casual), Undo and Discard Draft. Presentational: the composer owns the state and passes the actions in.

import { ChevronDown, X } from "lucide-react";
import type { Draft } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// These change the text in the reply box (yours or a draft you changed), keeping what it says.
const TONES: { key: Draft["tone"]; label: string }[] = [
  { key: "shorter", label: "Shorter" },
  { key: "formal", label: "More Formal" },
  { key: "casual", label: "More Casual" },
];

/** A tooltip for a control, saying what it does. */
function Hint({ text, children }: { text: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-64 text-balance">{text}</TooltipContent>
    </Tooltip>
  );
}

interface DraftBarProps {
  busy: boolean;
  /** The box has text, so Fix, Edit and Adjust apply. */
  hasText: boolean;
  /** The text is yours (or a draft you changed), so the AI may lightly correct it. */
  editable: boolean;
  undoable: boolean;
  hasDraft: boolean;
  draftLabel: string;
  /** What the reply should cover, as typed. Empty means write it from the conversation. */
  instruction: string;
  onInstruction: (value: string) => void;
  onDraft: () => void;
  onFix: () => void;
  onAskEdit: () => void;
  onAdjust: (tone: Draft["tone"]) => void;
  onUndo: () => void;
  onDiscard: () => void;
}

export function DraftBar({ busy, hasText, editable, undoable, hasDraft, draftLabel, instruction, onInstruction, onDraft, onFix, onAskEdit, onAdjust, onUndo, onDiscard }: DraftBarProps) {
  return (
    // Draft writes a whole new reply and replaces the box. Edit With AI works on what is already there. Tooltips are one short line; Draft, discard, attach and voice notes have none (their labels and icons say enough).
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {/* One step: say what it should cover (or nothing) and press Enter or Draft. The same text stays with the draft for another try. */}
      <Input
        value={instruction}
        onChange={(e) => onInstruction(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy) onDraft(); } }}
        placeholder="What Should This Say?"
        aria-label="What Should This Say?"
        maxLength={1000}
        className="h-8 min-w-0 flex-1 basis-48"
      />
      <Button type="button" variant="secondary" disabled={busy} onClick={onDraft}>{draftLabel}</Button>
      {(hasText || editable) && (
        // One menu for everything that works on the text in the box, so the bar stays one short row (and fits a phone).
        <DropdownMenu>
          <Hint text="Fix, change or reshape your text">
            <DropdownMenuTrigger asChild><Button type="button" variant="secondary" disabled={busy}>Edit With AI <ChevronDown /></Button></DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="start">
            {editable && hasText && <DropdownMenuItem onSelect={onFix}>Fix Typos and Grammar</DropdownMenuItem>}
            {editable && <DropdownMenuItem onSelect={onAskEdit}>Edit Text</DropdownMenuItem>}
            {hasText && TONES.map((t) => (
              <DropdownMenuItem key={t.key} onSelect={() => onAdjust(t.key)}>{t.label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {undoable && <Hint text="Brings back the earlier text"><Button type="button" variant="secondary" onClick={onUndo}>Undo</Button></Hint>}
      {hasDraft && <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Discard Draft" disabled={busy} onClick={onDiscard}><X /></Button>}
    </div>
  );
}
