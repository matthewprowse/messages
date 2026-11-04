"use client";

// Settings, Privacy and Data: Delete My Account (POPIA right to deletion). Re-authenticates, asks for the word DELETE and
// starts a 7 day grace period that can be cancelled here, with the same proof; the sync worker then deletes everything
// (apps/worker/src/account).
// A pending request is shown as a banner so it is never forgotten. Download My Data sits above this on purpose.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cancelDeletion, requestDeletion, type Proof } from "@/lib/account-api";
import { canCancel, GRACE_DAYS, isDeleteWord, pendingText, type PendingDeletion } from "@/lib/account-deletion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsBody, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { ReauthFields } from "@/components/settings/privacy/reauth-fields";

export function DeleteMyAccountSection() {
  const [pending, setPending] = useState<PendingDeletion | null | undefined>(undefined); // undefined while loading
  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [proof, setProof] = useState<Proof | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("account_deletions").select("run_after, status, error_code").maybeSingle();
    setPending(data ?? null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const close = () => { setOpen(false); setCancelOpen(false); setTyped(""); setProof(null); setError(null); };

  async function submit() {
    if (!proof || !isDeleteWord(typed)) return;
    setBusy(true);
    setError(null);
    const result = await requestDeletion(proof, typed.trim());
    setBusy(false);
    if ("error" in result) return setError(result.error);
    close();
    toast.success("Your account will be deleted. You can cancel until then.");
    await load();
  }

  async function cancel() {
    if (!proof) return;
    setBusy(true);
    setError(null);
    const problem = await cancelDeletion(proof);
    setBusy(false);
    if (problem) return setError(problem);
    close();
    toast.success("Deletion cancelled. Your account stays as it is.");
    await load();
  }

  return (
    <SettingsSection id="delete-account" title="Delete My Account">
      {pending && (
        <SettingsBody>
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{pending.status === "failed" ? "Deletion Needs Attention" : "Account Deletion Pending"}</AlertTitle>
            <AlertDescription>
              <p>{pending.status === "failed" ? "The deletion hit a problem and will be tried again. You can still cancel it." : pendingText(pending, Date.now())}</p>
              {canCancel(pending) && <Button variant="secondary" className="mt-2" disabled={busy} onClick={() => setCancelOpen(true)}>Cancel Deletion</Button>}
            </AlertDescription>
          </Alert>
        </SettingsBody>
      )}
      <SettingsRows>
        <SettingsRow title="Delete Everything">
          <Button variant="destructive" disabled={pending === undefined || !!pending} onClick={() => setOpen(true)}>Delete My Account</Button>
        </SettingsRow>
      </SettingsRows>

      <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) close(); }}>
        <DialogContent showCloseButton={false} className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Delete My Account</DialogTitle>
              <DialogDescription>
                After {GRACE_DAYS} days everything is deleted for good: every conversation and file, your contacts, notes, tasks and calendar, your connected accounts and your sign in. Nothing is sent from your accounts, and the originals at Gmail, Outlook and the rest are not touched.
              </DialogDescription>
            </DialogHeader>
            <ReauthFields onChange={setProof} />
            <div className="grid gap-2">
              <Label htmlFor="delete-word">Type DELETE to Confirm</Label>
              <Input id="delete-word" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder="DELETE" />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className={DIALOG_BUTTONS}>
              <Button type="button" variant="ghost" disabled={busy} onClick={close}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={busy || !proof || !isDeleteWord(typed)}>{busy ? "Checking…" : "Delete My Account"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cancelling needs the same proof as asking: a stolen session must not undo a deletion the owner asked for. */}
      <Dialog open={cancelOpen} onOpenChange={(o) => { if (!o && !busy) close(); }}>
        <DialogContent showCloseButton={false} className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); void cancel(); }} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Cancel Deletion</DialogTitle>
              <DialogDescription>Confirm it is you to keep your account. Nothing is deleted and everything stays as it is.</DialogDescription>
            </DialogHeader>
            <ReauthFields onChange={setProof} />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className={DIALOG_BUTTONS}>
              <Button type="button" variant="ghost" disabled={busy} onClick={close}>Back</Button>
              <Button type="submit" disabled={busy || !proof}>{busy ? "Checking…" : "Keep My Account"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
