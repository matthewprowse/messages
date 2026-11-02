"use client";

// Settings, AI, Templates and Snippets: your own reusable text. A template is picked from the reply box menu; a snippet is
// typed as ;shortcut. Both can hold {first_name}, {name}, {company} and {my_name}. Sealed with your key (use-user-templates.ts).

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { TEMPLATE_LIMITS, useUserTemplates, type UserTemplate } from "@/lib/use-user-templates";
import { MAX_SHORTCUT, normaliseShortcut } from "@/lib/snippets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

type Editing = { id?: string; kind: UserTemplate["kind"]; title: string; shortcut: string; body: string };

function EditDialog({ editing, onClose }: { editing: Editing | null; onClose: () => void }) {
  const { save } = useUserTemplates();
  const { notify } = useApp();
  const [draft, setDraft] = useState<Editing | null>(editing);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The dialog keeps its own copy while open, and takes a fresh one each time it is opened for something.
  const [seen, setSeen] = useState(editing);
  if (editing !== seen) { setSeen(editing); setDraft(editing); setError(null); }
  const snippet = draft?.kind === "snippet";
  const submit = async () => {
    if (!draft) return;
    setSaving(true);
    const problem = await save(draft);
    setSaving(false);
    if (problem) return setError(problem);
    notify(snippet ? "Snippet saved" : "Template saved");
    onClose();
  };
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} track="edit_template" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{draft?.id ? "Edit" : "Add"} {snippet ? "Snippet" : "Template"}</DialogTitle>
          <DialogDescription>Use {"{first_name}"}, {"{name}"}, {"{company}"} and {"{my_name}"} and they are filled in for the person you write to.</DialogDescription>
        </DialogHeader>
        {draft && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="template-title">Name</Label>
              <Input id="template-title" value={draft.title} maxLength={TEMPLATE_LIMITS.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={snippet ? "Thank you" : "Meeting follow-up"} autoFocus />
            </div>
            {snippet && (
              <div className="grid gap-2">
                <Label htmlFor="template-shortcut">Shortcut</Label>
                <Input id="template-shortcut" value={draft.shortcut} maxLength={MAX_SHORTCUT + 1} onChange={(e) => setDraft({ ...draft, shortcut: e.target.value })} placeholder=";thanks" />
                <p className="text-xs text-muted-foreground">Type {draft.shortcut ? `;${normaliseShortcut(draft.shortcut)}` : ";shortcut"} and a space in the reply box.</p>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="template-body">Text</Label>
              <Textarea id="template-body" rows={6} value={draft.body} maxLength={TEMPLATE_LIMITS.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="max-h-60" />
            </div>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="secondary" disabled={saving || !draft?.title.trim() || !draft?.body.trim()} onClick={submit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Your templates and snippets, with add, edit and remove (remove can be undone from the toast). */
export function TemplatesSection() {
  const { items, remove, save } = useUserTemplates();
  const { notify } = useApp();
  const [editing, setEditing] = useState<Editing | null>(null);
  const add = (kind: UserTemplate["kind"]) => setEditing({ kind, title: "", shortcut: "", body: "" });
  return (
    <SettingsSection id="templates" title="Templates and Snippets" description="Reusable text for the reply box. Pick a template from its menu, or type a snippet's shortcut, like ;thanks, and a space.">
      {items.length === 0 ? <SettingsEmpty>Nothing here yet.</SettingsEmpty> : (
        <SettingsRows>
          {items.map((t) => (
            <SettingsRow key={t.id} title={t.title} description={t.kind === "snippet" ? `Snippet, type ;${t.shortcut}` : "Template"}>
              <Button variant="ghost" size="icon" aria-label={`Edit ${t.title}`} onClick={() => setEditing({ ...t })}><Pencil /></Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${t.title}`} onClick={async () => { if (await remove(t.id)) notify(`${t.title} removed`, () => void save(t)); else notify("Could not remove it. Try again."); }}><Trash2 /></Button>
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => add("template")}>Add Template</Button>
        <Button variant="secondary" onClick={() => add("snippet")}>Add Snippet</Button>
      </div>
      <EditDialog editing={editing} onClose={() => setEditing(null)} />
    </SettingsSection>
  );
}
