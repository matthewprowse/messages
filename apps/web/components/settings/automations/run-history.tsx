"use client";

// The run history: every time an automation acted on an email, who it was about, what it did and whether it worked, newest first.
// A finished run has Undo, which removes the draft and task it made, the urgent mark, and the contact when it made them and nothing
// else has happened to them since.

import { useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsEmpty, SettingsRow, SettingsRows } from "@/components/settings/primitives";
import { undoRun, type Automation, type Run } from "@/lib/automations/io";
import { errorText, readByText, runWho, STATUS_LABEL } from "@/lib/automations/runs";
import { relTime } from "@/lib/format";

export function RunHistory({ runs, automations, onChanged }: { runs: Run[]; automations: Automation[]; onChanged: () => void }) {
  const [undoing, setUndoing] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => automations.find((a) => a.id === id)?.spec.name ?? "Automation";

  const undo = async () => {
    if (!undoing) return;
    setBusy(true);
    try {
      toast(await undoRun(undoing));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not undo this run. Try again.");
    }
    setBusy(false);
    setUndoing(null);
    onChanged();
  };

  if (runs.length === 0) return <SettingsEmpty>Nothing has run yet.</SettingsEmpty>;
  return (
    <>
      <SettingsRows>
        {runs.map((r) => (
          <SettingsRow
            key={r.id}
            title={<>{runWho(r.fields)} <Badge variant={r.status === "failed" ? "destructive" : r.status === "done" ? "secondary" : "outline"}>{STATUS_LABEL[r.status] ?? r.status}</Badge></>}
            description={
              <>
                <span className="block truncate">{[nameOf(r.automationId), relTime(r.createdAt), readByText(r.readBy)].filter(Boolean).join(" · ")}</span>
                {errorText(r.error) && <span className="block">{errorText(r.error)}</span>}
              </>
            }
          >
            {r.status === "done" && <Button variant="ghost" onClick={() => setUndoing(r)}>Undo</Button>}
          </SettingsRow>
        ))}
      </SettingsRows>
      <AlertDialog open={undoing !== null} onOpenChange={(open) => { if (!open) setUndoing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo This Run?</AlertDialogTitle>
            <AlertDialogDescription>
              The draft, task and urgent mark it made are removed. {undoing?.effects.contact_created ? "The contact it made is deleted unless something else has happened to them since, in which case only the Lead mark comes off." : "The person was already a contact, so only the Lead mark and details this run added come off."} The email itself is not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void undo(); }}>Undo Run</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
