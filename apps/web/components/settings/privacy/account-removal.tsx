"use client";

// Settings, Privacy and Data: Connected Accounts, with the two ways to let one go. Disconnect stops syncing and forgets the
// stored sign-in but keeps every message. Remove also deletes that account's conversations, files and sign-in, after typing
// REMOVE; the sync worker does the deleting (apps/worker/src/account), so it can take a few minutes.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/lib/store";
import { groupAccounts, partsOf, type AccountGroup } from "@/lib/account-groups";
import { isRemoveWord } from "@/lib/account-deletion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { AccountStatusBadge } from "@/components/settings/connect-family";
import { groupName } from "@/components/settings/account-dialogs";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

export function ConnectedAccountsSection() {
  const { accounts, dispatch } = useApp();
  const groups = groupAccounts(accounts);
  const [leaving, setLeaving] = useState<AccountGroup | null>(null); // Disconnect
  const [removing, setRemoving] = useState<AccountGroup | null>(null); // Remove
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<Set<string>>(new Set()); // accounts whose removal is waiting for the worker

  const loadQueue = useCallback(async () => {
    const { data } = await supabase.from("account_removals").select("account_id");
    setQueued(new Set((data ?? []).map((r) => r.account_id)));
  }, []);
  useEffect(() => { void loadQueue(); }, [loadQueue]);

  async function disconnect(g: AccountGroup) {
    setBusy(true);
    const { error } = await supabase.rpc("disconnect_account", { p_accounts: g.accounts.map((a) => a.id) });
    setBusy(false);
    setLeaving(null);
    if (error) return toast.error("Could not disconnect it. Try again.");
    for (const a of g.accounts) dispatch({ type: "patchAccount", id: a.id, patch: { status: "disconnected" } });
    toast.success(`${groupName(g)} disconnected. Your messages are kept.`);
  }

  async function remove(g: AccountGroup) {
    if (!isRemoveWord(typed)) return;
    setBusy(true);
    const { error } = await supabase.rpc("request_account_removal", { p_accounts: g.accounts.map((a) => a.id), p_confirm: "REMOVE" });
    setBusy(false);
    if (error) return toast.error("Could not remove it. Try again.");
    setRemoving(null);
    setTyped("");
    for (const a of g.accounts) dispatch({ type: "patchAccount", id: a.id, patch: { status: "disconnected" } });
    await loadQueue();
    toast.success(`Removing ${groupName(g)}. This can take a few minutes.`);
  }

  return (
    <SettingsSection id="connected-accounts" title="Disconnect or Remove an Account">
      {groups.length === 0 ? <SettingsEmpty>No accounts connected.</SettingsEmpty> : (
        <SettingsRows>
          {groups.map((g) => {
            const waiting = g.accounts.some((a) => queued.has(a.id));
            const disconnected = g.accounts.every((a) => a.status === "disconnected");
            return (
              <SettingsRow
                key={g.key}
                title={<>{groupName(g)} {waiting ? <span className="text-xs font-normal text-muted-foreground">Removal Queued</span> : <AccountStatusBadge status={disconnected ? "disconnected" : g.accounts[0].status} />}</>}
                description={partsOf(g)}
              >
                {!waiting && <Button variant="secondary" disabled={disconnected} onClick={() => setLeaving(g)}>Disconnect</Button>}
                {!waiting && <Button variant="destructive" onClick={() => { setTyped(""); setRemoving(g); }}>Remove</Button>}
              </SettingsRow>
            );
          })}
        </SettingsRows>
      )}

      <AlertDialog open={leaving !== null} onOpenChange={(o) => { if (!o && !busy) setLeaving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Account?</AlertDialogTitle>
            <AlertDialogDescription>
              {leaving && groupName(leaving)} stops syncing and Konva forgets how to sign in to it. Everything already here stays. To sync it again you connect it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); if (leaving) void disconnect(leaving); }}>Disconnect</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={removing !== null} onOpenChange={(o) => { if (!o && !busy) setRemoving(null); }}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); if (removing) void remove(removing); }} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Remove Account</DialogTitle>
              <DialogDescription>
                This deletes every conversation, message and file that came from {removing && groupName(removing)}, and forgets its sign in. It cannot be undone. Nothing is deleted at the provider, and your other accounts are not touched.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="remove-word">Type REMOVE to Confirm</Label>
              <Input id="remove-word" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder="REMOVE" />
            </div>
            <div className={DIALOG_BUTTONS}>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={busy || !isRemoveWord(typed)}>{busy ? "Removing…" : "Remove Account"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
