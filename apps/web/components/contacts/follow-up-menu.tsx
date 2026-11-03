"use client";

// "Follow Up" on a contact's page: pick when, and a "Check In With ..." task is made in the user's task list with the
// contact attached (contact-nudge-io.ts). Nothing is sent to the contact.

import { useState } from "react";
import { toast } from "sonner";
import { BellPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/tip";
import { NUDGES, nudgeAccount, nudgeForm } from "@/lib/contact-nudge";
import { queueNudge } from "@/lib/contact-nudge-io";
import { useApp } from "@/lib/store";

export function FollowUpMenu({ contactId, name }: { contactId: string; name: string }) {
  const { accounts } = useApp();
  const [busy, setBusy] = useState(false);
  const account = nudgeAccount(accounts);

  const remind = async (days: number) => {
    if (!account || busy) return;
    setBusy(true);
    toast("Setting the reminder.");
    const problem = await queueNudge(nudgeForm(name, account.id, days), contactId, account.provider);
    setBusy(false);
    toast(problem ?? "Reminder set. It is in your tasks.");
  };

  return (
    <DropdownMenu modal={false}>
      <Tip label="Follow Up">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Follow Up" disabled={busy}><BellPlus /></Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-max">
        {account ? (
          <>
            <DropdownMenuLabel>Remind Me to Check In</DropdownMenuLabel>
            {NUDGES.map((n) => <DropdownMenuItem key={n.key} onSelect={() => void remind(n.days)}>{n.label}</DropdownMenuItem>)}
          </>
        ) : (
          <DropdownMenuItem disabled className="flex-col items-start gap-0">
            <span>Remind Me to Check In</span>
            <span className="text-xs text-muted-foreground">Available once a task list is connected</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
