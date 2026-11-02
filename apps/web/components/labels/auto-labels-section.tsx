"use client";

// The Auto part of Manage Labels: switch up to six labels to Auto and say in a line what belongs under each. The AI then
// puts at most one of them on a new conversation, and never puts back one you took off. Descriptions are stored encrypted.

import { useEffect, useState } from "react";
import { AUTO_MAX, DESCRIPTION_MAX, autoCount } from "@/lib/auto-labels";
import { labelDot, type Label } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAutoLabels } from "./use-auto-labels";

function AutoRow({ label, auto, description, save }: { label: Label; auto: boolean; description: string; save: (id: string, auto: boolean, description: string) => Promise<boolean> }) {
  const [text, setText] = useState(description);
  useEffect(() => { setText(description); }, [description]);
  return (
    <div className="flex items-center gap-2">
      <span className="flex min-w-0 items-center gap-2 text-sm sm:w-28 sm:shrink-0"><span className={cn("size-2 shrink-0 rounded-full", labelDot(label.color))} aria-hidden /><span className="truncate">{label.name}</span></span>
      <Input
        value={text}
        maxLength={DESCRIPTION_MAX}
        placeholder="What belongs here"
        aria-label={`What belongs under ${label.name}`}
        className="h-8 min-w-0 flex-1"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (auto && text.trim() !== description) void save(label.id, true, text); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      <Switch checked={auto} disabled={!auto && !text.trim()} aria-label={`Auto for ${label.name}`} onCheckedChange={(on) => void save(label.id, on, text)} />
    </div>
  );
}

/** The Auto switches and descriptions, for the labels given. Reads its settings only while `active`. */
export function AutoLabelsSection({ labels, active }: { labels: Label[]; active: boolean }) {
  const { settings, save } = useAutoLabels(active);
  if (labels.length === 0) return null;
  return (
    <div className="space-y-2 border-t pt-3">
      <div>
        <h3 className="text-sm font-medium">Auto Labels</h3>
        <p className="text-xs text-muted-foreground">Describe what belongs under a label and turn on Auto. New conversations get at most one, and a label you take off stays off. {autoCount(settings)} of {AUTO_MAX} used.</p>
      </div>
      <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
        {labels.map((l) => <AutoRow key={l.id} label={l} auto={settings.get(l.id)?.auto ?? false} description={settings.get(l.id)?.description ?? ""} save={save} />)}
      </div>
    </div>
  );
}
