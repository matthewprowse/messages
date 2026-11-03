"use client";

// The dialog for writing or editing a changelog release, used on the Updates page. Closing with unsaved text asks first, a
// save from a stale copy is refused (lib/updates.ts), and Enter in a change adds the next change instead of saving.

import { useEffect, useState } from "react";
import { ChevronDownIcon, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { dateKey } from "@/lib/new-items";
import { CHANGE_KINDS, StaleUpdateError, dayLabel, deleteUpdate, draftSnapshot, fromDateKey, publishWarning, saveUpdate, updateProblem, type Change, type Update, type UpdateDraft } from "@/lib/updates";
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

const blank = (version: string): UpdateDraft => ({ version, title: "", summary: "", changes: [{ kind: "new", text: "" }], releasedOn: dateKey(new Date()), published: false });
const fromUpdate = (u: Update): UpdateDraft => ({ ...u, changes: u.changes.length ? u.changes : [{ kind: "new", text: "" }] });

/** A release in the changelog: its version, date, title, a line about it, and what changed, each marked New, Improved or Fixed. */
export function UpdateDialog({ open, onOpenChange, editing, suggestedVersion, onSaved, onDeleted, onStale }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Update;
  /** The version a new release starts with: the next patch after the latest one. */
  suggestedVersion: string;
  /** Called when a save was refused because the release changed elsewhere, so the list can reload. */
  onStale: () => void;
  onSaved: (update: Update) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<UpdateDraft>(() => blank(suggestedVersion));
  const [start, setStart] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only when the dialog opens or a different release is chosen, so a refreshed list cannot wipe what is being typed.
  const editingId = editing?.id;
  useEffect(() => {
    if (!open) return;
    const next = editing ? fromUpdate(editing) : blank(suggestedVersion);
    setDraft(next);
    setStart(draftSnapshot(next));
    setError(null);
  }, [open, editingId]);

  // Closing with unsaved text asks first.
  const requestClose = (next: boolean) => {
    if (next || draftSnapshot(draft) === start) return onOpenChange(next);
    setConfirmClose(true);
  };

  const set = (patch: Partial<UpdateDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setChange = (i: number, patch: Partial<Change>) => set({ changes: draft.changes.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  // Enter in a change starts the next one; saving is the Save button's job.
  const addOnEnter = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (i === draft.changes.length - 1 && draft.changes[i].text.trim()) set({ changes: [...draft.changes, { kind: draft.changes[i].kind, text: "" }] });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = updateProblem(draft);
    if (problem) { setError(problem); return; }
    const warning = publishWarning(draft);
    if (warning) { setError(`${warning} Add a change or switch Published off.`); return; }
    setSaving(true);
    try {
      const saved = await saveUpdate(draft);
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof StaleUpdateError) {
        setError("This update was saved elsewhere since you opened it. Close this and open it again to see the newer text.");
        onStale();
      } else setError("The update could not be saved. Try again.");
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
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Update" : "New Update"}</DialogTitle>
            <DialogDescription>What changed in a release. Only you can see updates for now.</DialogDescription>
          </DialogHeader>
          <form id="update-form" onSubmit={save} className="grid gap-3">
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="update-version">Version</Label>
                <Input id="update-version" value={draft.version} onChange={(e) => set({ version: e.target.value })} maxLength={20} placeholder="0.0.13" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="update-date">Date</Label>
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <Button id="update-date" type="button" variant="outline" className="h-8 min-w-0 justify-between font-normal">
                      <span className="truncate">{dayLabel(draft.releasedOn)}</span>
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
                  <Input value={c.text} onChange={(e) => setChange(i, { text: e.target.value })} onKeyDown={(e) => addOnEnter(e, i)} maxLength={300} aria-label="Change" placeholder="What changed" className="min-w-0 flex-1" />
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
            <Button type="submit" form="update-form" variant="secondary" disabled={saving}>{saving ? "Saving" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes?</AlertDialogTitle>
            <AlertDialogDescription>What you wrote in this update has not been saved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Writing</AlertDialogCancel>
            <AlertDialogAction variant="secondary" onClick={() => { setConfirmClose(false); onOpenChange(false); }}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
