"use client";

import { useEffect, useMemo, useState } from "react";
import { markSubmitted } from "@/lib/analytics";
import { useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { deleteContact, type ContactDetail, type ContactSummary } from "@/lib/contacts";
import { listAutomaticMerges, mergeSide, type MergeRecord } from "@/lib/contact-merging";
import { identityGroups, mergeReasonText, planMerge } from "@/lib/merging";
import { relTime } from "@/lib/format";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContactAvatar } from "@/components/primitives";
import { DIALOG_BUTTONS, MergeDialog, useCloseOnOverlay } from "@/components/merge-dialog";
import { useContactsData } from "@/components/contacts-data";
import { byRecent, Divided, firstReach, Section } from "@/components/contact-list";
import { withQuery } from "@/lib/utils";

function useContactHref() {
  const query = useSearchParams().toString();
  return (id: string) => withQuery(`/contacts/${id}`, query);
}

/** Search other people, then confirm the merge. */
function MergeWithDialog({ contact, open, onOpenChange }: { contact: ContactDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { contacts } = useContactsData();
  const { mergeContacts } = useApp();
  const router = useRouter();
  const hrefOf = useContactHref();
  const [target, setTarget] = useState<ContactSummary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const others = useMemo(
    () => (contacts ?? []).filter((c) => c.id !== contact.id).sort(byRecent),
    [contacts, contact.id],
  );

  const merge = async (name?: string) => {
    if (!target) return;
    const plan = planMerge(mergeSide(contact), mergeSide(target), name);
    const id = await mergeContacts(plan.keepId, plan.mergeId, "manual", plan.name);
    if (id && plan.keepId !== contact.id) router.replace(hrefOf(plan.keepId));
  };

  return (
    <>
      <CommandDialog open={open} onOpenChange={onOpenChange} title="Merge With" description="Search for the person to merge with">
        <CommandInput placeholder="Search People" />
        <CommandList>
          <CommandEmpty>{contacts === undefined ? "Loading people" : "No people found."}</CommandEmpty>
          <CommandGroup heading="People">
            {others.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.name} ${c.emails.join(" ")} ${c.phones.join(" ")} ${c.id}`}
                onSelect={() => {
                  setTarget(c);
                  onOpenChange(false);
                  setConfirming(true);
                }}
              >
                <ContactAvatar contact={c} className="size-6" />
                <span className="min-w-0 truncate">{c.name}</span>
                <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{firstReach(c)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <MergeDialog a={contact} b={target} open={confirming} onOpenChange={setConfirming} onConfirm={(name) => merge(name)} />
    </>
  );
}

// Mounted only while the dialog is open, so nothing is ticked each time it opens.
function SplitForm({ contact, onDone }: { contact: ContactDetail; onDone: () => void }) {
  const { splitContact } = useApp();
  const router = useRouter();
  const hrefOf = useContactHref();
  const groups = useMemo(() => identityGroups(contact.identityRows), [contact.identityRows]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const ready = !saving && trimmed.length > 0 && chosen.size > 0 && chosen.size < groups.length;

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    const ids = [...chosen].flatMap((i) => groups[i].ids);
    const id = await splitContact(contact.id, ids, trimmed);
    setSaving(false);
    if (!id) return;
    markSubmitted("split_contact");
    onDone();
    toast(`Moved to ${trimmed}`, { action: { label: "Open", onClick: () => router.push(hrefOf(id)) } });
  };

  const toggle = (i: number, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(i);
      else next.delete(i);
      return next;
    });

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="rounded-lg border px-4">
        <Divided>
          {groups.map((g, i) => (
            <label key={g.ids.join(",")} className="flex items-center gap-3 py-3">
              <Checkbox checked={chosen.has(i)} disabled={saving} onCheckedChange={(on) => toggle(i, on === true)} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{g.label}</span>
                <span className="truncate text-xs text-muted-foreground">{g.detail}</span>
              </span>
            </label>
          ))}
        </Divided>
      </div>
      {chosen.size > 0 && chosen.size === groups.length && <p className="text-xs text-muted-foreground">Leave at least one address or number on {contact.name}.</p>}
      <div className="grid gap-2">
        <Label htmlFor="split-name">Name of the New Person</Label>
        <Input id="split-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={saving} />
      </div>
      <div className={DIALOG_BUTTONS}>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!ready}>{saving ? "Splitting" : "Split"}</Button>
      </div>
    </form>
  );
}

/** Moves the chosen addresses and numbers to a new person. */
function SplitDialog({ contact, open, onOpenChange }: { contact: ContactDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track="split_contact" className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Split Contact</DialogTitle>
          <DialogDescription>Choose what belongs to someone else. Their messages and conversations move with them.</DialogDescription>
        </DialogHeader>
        <SplitForm contact={contact} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Deletes the person, then goes back to the list. Their conversations and messages stay. */
function DeleteDialog({ contact, backHref, open, onOpenChange }: { contact: ContactDetail; backHref: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { refreshContacts } = useApp();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  useCloseOnOverlay(open && !deleting, onOpenChange);

  const confirm = async () => {
    setDeleting(true);
    const error = await deleteContact(contact.id);
    setDeleting(false);
    if (error) {
      toast(error);
      return;
    }
    markSubmitted("delete_contact");
    onOpenChange(false);
    router.push(backHref);
    toast(`Deleted ${contact.name}`);
    void refreshContacts([contact.id]);
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <AlertDialogContent track="delete_contact">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {contact.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Your conversations and messages with them stay, but show no name for them. Only the person and their saved details go, such as their addresses, numbers and company. New mail from their addresses will create a contact again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className={DIALOG_BUTTONS}>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={(e) => {
              // Stays open until the delete is done.
              e.preventDefault();
              void confirm();
            }}
          >
            {deleting ? "Deleting" : "Delete Contact"}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The contact page's menu: Edit (on phones, where the header has no room for its button), Merge With..., Split and Delete Contact. */
export function ContactMenu({ contact, backHref, onEdit }: { contact: ContactDetail; backHref: string; onEdit?: () => void }) {
  const [open, setOpen] = useState<"merge" | "split" | "delete" | null>(null);
  const set = (item: "merge" | "split" | "delete") => (value: boolean) => setOpen(value ? item : null);
  const canSplit = useMemo(() => identityGroups(contact.identityRows).length > 1, [contact.identityRows]);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max">
          {onEdit && <DropdownMenuItem className="sm:hidden" onSelect={onEdit}>Edit</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => setOpen("merge")}>Merge With...</DropdownMenuItem>
          <DropdownMenuItem disabled={!canSplit} onSelect={() => setOpen("split")}>Split</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setOpen("delete")}>Delete Contact</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <MergeWithDialog contact={contact} open={open === "merge"} onOpenChange={set("merge")} />
      <SplitDialog contact={contact} open={open === "split"} onOpenChange={set("split")} />
      <DeleteDialog contact={contact} backHref={backHref} open={open === "delete"} onOpenChange={set("delete")} />
    </>
  );
}

/** Automatic merges into this contact, each with Undo. Nothing shows when there are none. */
export function MergedAutomatically({ contact }: { contact: ContactDetail }) {
  const { undoMerge, contactsVersion } = useApp();
  const [merges, setMerges] = useState<MergeRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Joined so the effect reruns only when the addresses change, not on every new array.
  const emails = contact.emails.join(",");
  const phones = contact.phones.join(",");

  useEffect(() => {
    let cancelled = false;
    listAutomaticMerges(contact.id, { emails: emails ? emails.split(",") : [], phones: phones ? phones.split(",") : [] })
      .then((rows) => !cancelled && setMerges(rows))
      .catch((err) => console.error(err instanceof Error ? err.message : "Load merges failed"));
    return () => {
      cancelled = true;
    };
  }, [contact.id, emails, phones, contactsVersion]);

  if (merges.length === 0) return null;
  return (
    <Section title="Merged Automatically">
      <div className="rounded-lg border px-4">
        <Divided>
          {merges.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{m.mergedName}</span>
                <span className="truncate text-xs text-muted-foreground">{mergeReasonText(m.reason, m.providers)}, {relTime(m.createdAt)}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(m.id);
                  if (await undoMerge(m.id)) setMerges((list) => list.filter((x) => x.id !== m.id));
                  setBusy(null);
                }}
              >
                {busy === m.id ? "Undoing" : "Undo"}
              </Button>
            </div>
          ))}
        </Divided>
      </div>
    </Section>
  );
}
