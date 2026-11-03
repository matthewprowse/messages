"use client";

// The two dialogs on the Accounts page: Pause Sync and Rename. Each takes the sign-in it is about, or null when closed.

import { useEffect, useState } from "react";
import { FAMILY_NAME, type AccountGroup } from "@/lib/account-groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/** What a sign-in is called: the nickname, else its family (Google), else its first part's label. */
export const groupName = (g: AccountGroup) => g.accounts.find((a) => a.nickname)?.nickname || FAMILY_NAME[g.family] || g.accounts[0].label;

/** Asks before pausing, and says that resuming needs no sign-in. */
export function PauseDialog({ group, onClose, onPause }: { group: AccountGroup | null; onClose: () => void; onPause: (g: AccountGroup) => void }) {
  return (
    <AlertDialog open={group !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent track="pause_sync">
        <AlertDialogHeader>
          <AlertDialogTitle>Pause Sync?</AlertDialogTitle>
          <AlertDialogDescription>
            {group && groupName(group)} stops syncing and new messages stop arriving. Nothing is deleted, and you can resume it at any time without signing in again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => group && onPause(group)}>Pause Sync</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The nickname form. An empty name goes back to the default. */
export function RenameDialog({ group, onClose, onSave }: { group: AccountGroup | null; onClose: () => void; onSave: (g: AccountGroup, name: string) => void }) {
  const [name, setName] = useState("");
  useEffect(() => { if (group) setName(group.accounts.find((a) => a.nickname)?.nickname ?? ""); }, [group]);
  const base = group ? FAMILY_NAME[group.family] ?? group.accounts[0].label : undefined;
  return (
    <Dialog open={group !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Account</DialogTitle>
          <DialogDescription>
            Shown next to the logo in your inbox, and only once you have more than one {base ?? "account"} connected. Leave it empty to use the default name.
          </DialogDescription>
        </DialogHeader>
        <form id="rename-account" onSubmit={(e) => { e.preventDefault(); if (group) onSave(group, name.trim()); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={base} aria-label="Account Name" autoFocus />
        </form>
        <DialogFooter>
          <Button variant="secondary" type="submit" form="rename-account">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
