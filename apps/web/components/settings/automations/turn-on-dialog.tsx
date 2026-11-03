"use client";

// Turning an automation on, with the preview "In the last 30 days this would have made N leads" and its list. Opening the dialog asks
// the AI worker to read the last 30 days of mail with the same When and the same reader a live run uses; nothing is made. Turn On
// never waits for the preview: it only affects mail that arrives afterwards, and a worker that is down or slow would otherwise hold
// it for 90 seconds. The preview shows when it arrives, or a plain line says it was skipped.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { dropPreview, requestPreview, saveAutomation, setEnabled, waitForPreview, type Automation } from "@/lib/automations/io";
import { previewHeadline, previewNote, type PreviewResult } from "@/lib/automations/preview";
import { doSummary, type AutomationSpec } from "@/lib/automations/spec";
import { relTime } from "@/lib/format";

/** What is being turned on: a saved automation, or a setup not yet saved (a template from the gallery). */
export interface TurnOn {
  automation?: Automation;
  templateKey: string | null;
  spec: AutomationSpec;
}

export function TurnOnDialog({ target, onClose, onDone }: { target: TurnOn | null; onClose: () => void; onDone: () => void }) {
  const [state, setState] = useState<{ result: PreviewResult } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setState(null);
    const abort = new AbortController();
    let id: string | null = null;
    void (async () => {
      const asked = await requestPreview(target.spec, target.templateKey);
      if ("error" in asked) return setState(asked);
      id = asked.id;
      if (abort.signal.aborted) return void dropPreview(id);
      const answer = await waitForPreview(id, abort.signal);
      if (!abort.signal.aborted) setState(answer);
      void dropPreview(id);
    })();
    return () => {
      abort.abort();
      if (id) void dropPreview(id);
    };
  }, [target]);

  const turnOn = async () => {
    if (!target) return;
    setBusy(true);
    const problem = target.automation ? await setEnabled(target.automation.id, true) : await saveAutomation({ templateKey: target.templateKey, spec: target.spec, enabled: true });
    setBusy(false);
    if (problem) return toast(problem);
    toast(`${target.spec.name} is on. It runs on new email from now.`);
    onDone();
    onClose();
  };

  const result = state && "result" in state ? state.result : null;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Turn On {target?.spec.name}</DialogTitle>
          <DialogDescription>Here is what it would have done over the last 30 days. Nothing is made until you turn it on, and then only for new email.</DialogDescription>
        </DialogHeader>
        <div className="min-h-24 space-y-3 text-sm">
          {state === null && (
            <div className="space-y-2" aria-live="polite">
              <p className="text-muted-foreground">Looking through the last 30 days of email.</p>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
          {state && "error" in state && state.error && <p className="text-muted-foreground" role="status">{state.error}</p>}
          {result && (
            <>
              <p className="font-medium">{previewHeadline(result)}</p>
              {previewNote(result) && <p className="text-xs text-muted-foreground">{previewNote(result)}</p>}
              {result.leads.length > 0 && (
                <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                  {result.leads.map((l, i) => (
                    <li key={`${l.name}-${i}`} className="flex items-baseline justify-between gap-3 p-2">
                      <span className="min-w-0 truncate">{l.name}{l.listing ? <span className="text-muted-foreground">{` · ${l.listing}`}</span> : null}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{l.enquiries > 1 ? `${l.enquiries} enquiries · ` : ""}{l.at ? relTime(l.at) : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {target && <p className="text-xs text-muted-foreground">When it is on, each new match: {doSummary(target.spec).join(", ").toLowerCase() || "does nothing"}. Nothing is ever sent without you.</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => void turnOn()}>Turn On</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
