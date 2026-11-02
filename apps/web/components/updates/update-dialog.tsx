"use client";

// The dialog for writing or editing a changelog release, used on the Updates page.

import { useEffect, useState } from "react";
import { ChevronDownIcon, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { dateKey } from "@/lib/new-items";
import { CHANGE_KINDS, deleteUpdate, saveUpdate, updateProblem, type Change, type Update, type UpdateDraft } from "@/lib/updates";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

function fromDateKey(key: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

const blank = (): UpdateDraft => ({ version: "", title: "", summary: "", changes: [{ kind: "new", text: "" }], releasedOn: dateKey(new Date()), published: false });

/** A release in the changelog: its version, date, title, a line about it, and what changed, each marked New, Improved or Fixed. */
export function UpdateDialog({ open, onOpenChange, editing, onSaved, onDeleted }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Update;
  onSaved: (update: Update) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<UpdateDraft>(blank);
  const [saving, setSaving] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(editing ? { ...editing, changes: editing.changes.length ? editing.changes : [{ kind: "new", text: "" }] } : blank());
    setError(null);
  }, [open, editing]);

  const set = (patch: Partial<UpdateDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setChange = (i: number, patch: Partial<Change>) => set({ changes: draft.changes.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = updateProblem(draft);
    if (problem) { setError(problem); return; }
    setSaving(true);
    try {
      const saved = await saveUpdate(draft);
      onSaved(saved);
      onOpenChange(false);
    } catch {
      setError("The update could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    try {
      await deleteUpdate(editing.id);
      onDeleted(editing.id);
      onOpenChange(false);
    } catch {
      toast.error("The update could not be deleted. Try again.");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showCloseButton={false} className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Update" : "New Update"}</DialogTitle>
            <DialogDescription>What changed in a release. It stays private to you until updates are made public.</DialogDescription>
          </DialogHeader>
          <form id="update-form" onSubmit={save} className="grid gap-3">
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="update-version">Version</Label>
                <Input id="update-version" value={draft.version} onChange={(e) => set({ version: e.target.value })} maxLength={20} placeholder="0.0.4" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="update-date">Date</Label>
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <Button id="update-date" type="button" variant="outline" className="h-8 min-w-0 justify-between font-normal">
                      <span className="truncate">{fromDateKey(draft.releasedOn)?.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
                      <ChevronDownIcon className="text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={fromDateKey(draft.releasedOn)}
                      defaultMonth={fromDateKey(draft.releasedOn)}
                      weekStartsOn={1}
                      captionLayout="dropdown"
                      onSelect={(d) => { if (d) set({ releasedOn: dateKey(d) }); setDateOpen(false); }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="update-title">Title</Label>
              <Input id="update-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder="A short name for the release" autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="update-summary">Summary</Label>
              <Textarea id="update-summary" value={draft.summary} onChange={(e) => set({ summary: e.target.value })} maxLength={500} rows={3} placeholder="One or two sentences on what this release is about" />
            </div>
            <div className="grid gap-1.5">
              <Label>Changes</Label>
              {draft.changes.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={c.kind} onValueChange={(v) => setChange(i, { kind: v as Change["kind"] })}>
                    <SelectTrigger aria-label="Kind" className="w-28 shrink-0 data-[size=default]:h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{CHANGE_KINDS.map((k) => <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input value={c.text} onChange={(e) => setChange(i, { text: e.target.value })} maxLength={300} aria-label="Change" placeholder="What changed" className="min-w-0 flex-1" />
                  {draft.changes.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove Change" onClick={() => set({ changes: draft.changes.filter((_, j) => j !== i) })}><X /></Button>
                  )}
                  {i === draft.changes.length - 1 && (
                    <Button type="button" variant="secondary" size="icon" aria-label="Add Change" title="Add Change" disabled={!c.text.trim()} onClick={() => set({ changes: [...draft.changes, { kind: c.kind, text: "" }] })}><Plus /></Button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <Label htmlFor="update-published">Published</Label>
                <span className="text-xs text-muted-foreground">Ready to show people. Leave it off while you are still writing it.</span>
              </div>
              <Switch id="update-published" checked={draft.published} onCheckedChange={(published) => set({ published })} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </form>
          <DialogFooter>
            {editing && <Button type="button" variant="ghost" className="sm:mr-auto" onClick={() => setConfirmDelete(true)}>Delete</Button>}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" form="update-form" variant="secondary" disabled={saving}>{saving ? "Saving" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Update?</AlertDialogTitle>
            <AlertDialogDescription>This removes it from the changelog for good.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="secondary" onClick={() => void remove()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
