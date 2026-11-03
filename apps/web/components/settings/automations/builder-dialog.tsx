"use client";

// The builder for a Custom automation (and for changing any saved one): When it arrives, Read which fields, Do what. It saves the
// setup switched off; turning it on goes through the preview (turn-on-dialog.tsx). Lists are typed with commas or one a line.

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveAutomation, type Automation } from "@/lib/automations/io";
import { fieldKey, MAX_DESCRIPTION, MAX_FIELDS, MAX_TEXT, specProblem, splitList, type AutomationSpec } from "@/lib/automations/spec";

const EMAIL_PROVIDERS = new Set(["gmail", "outlook", "icloud", "imap"]);

interface Draft {
  name: string;
  senders: string;
  /** Kept as it was: only a template has these, and changing a template's emails must not lose them. */
  anywhere: string[];
  subject: string;
  body: string;
  accounts: string[];
  fields: { label: string; description: string }[];
  contact: boolean;
  lead: boolean;
  source: string;
  link: boolean;
  task: boolean;
  taskTitle: string;
  taskMinutes: string;
  draft: boolean;
  urgent: boolean;
}

const lines = (v: string[]) => v.join("\n");

function toDraft(spec: AutomationSpec): Draft {
  return {
    name: spec.name, senders: lines(spec.when.senders), anywhere: spec.when.anywhere, subject: lines(spec.when.subject), body: lines(spec.when.body), accounts: spec.when.accounts,
    fields: spec.read.fields.map((f) => ({ label: f.key.replace(/_/g, " "), description: f.description })),
    contact: spec.do.contact, lead: spec.do.lead, source: spec.do.source, link: spec.do.link,
    task: spec.do.task !== null, taskTitle: spec.do.task?.title ?? "Call Back Within 5 Minutes", taskMinutes: String(spec.do.task?.minutes ?? 5),
    draft: spec.do.draft, urgent: spec.do.urgent,
  };
}

function toSpec(d: Draft): AutomationSpec {
  const minutes = Number(d.taskMinutes);
  return {
    name: d.name.trim(),
    when: { senders: splitList(d.senders), subject: splitList(d.subject), body: splitList(d.body), anywhere: d.anywhere, accounts: d.accounts },
    read: { fields: d.fields.map((f) => ({ key: fieldKey(f.label), description: f.description.trim().slice(0, MAX_DESCRIPTION) })).filter((f) => f.key) },
    do: {
      contact: d.contact, lead: d.lead, source: d.source.trim() || d.name.trim(), link: d.link,
      task: d.task && d.taskTitle.trim() ? { title: d.taskTitle.trim(), minutes: Number.isFinite(minutes) ? Math.round(minutes) : 5 } : null,
      draft: d.draft, urgent: d.urgent,
    },
  };
}

function Check({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="font-normal">{children}</Label>
    </div>
  );
}

/** automation is the saved one being changed, or undefined for a new Custom automation. open is whether the dialog shows. */
export function BuilderDialog({ open, automation, initial, onClose, onSaved }: { open: boolean; automation?: Automation; initial: AutomationSpec; onClose: () => void; onSaved: () => void }) {
  const { accounts } = useApp();
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setD(toDraft(automation?.spec ?? initial)); setProblem(null); } }, [open, automation, initial]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((p) => ({ ...p, [key]: value }));
  const custom = !automation || automation.templateKey === null;
  const mail = accounts.filter((a) => EMAIL_PROVIDERS.has(a.provider));

  const save = async () => {
    const spec = toSpec(d);
    const found = specProblem(spec, custom);
    if (found) return setProblem(found);
    setBusy(true);
    const failed = await saveAutomation({ id: automation?.id, templateKey: automation?.templateKey ?? null, spec });
    setBusy(false);
    if (failed) return setProblem(failed);
    toast(automation ? "Saved" : "Saved. Turn it on when you are ready.");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{automation ? "Change Automation" : "New Custom Automation"}</DialogTitle>
        </DialogHeader>
        <form id="automation-form" className="space-y-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="space-y-2">
            <Label htmlFor="automation-name">Name</Label>
            <Input id="automation-name" value={d.name} maxLength={MAX_TEXT} onChange={(e) => set("name", e.target.value)} placeholder="Website Enquiry" />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">When</legend>
            <p className="text-xs text-muted-foreground">An email must meet every box you fill in. In a box, any one entry is enough.</p>
            {!custom && <p className="text-xs text-muted-foreground">This template reads its emails with a fixed reader. You can change which emails it looks at.</p>}
            <div className="space-y-2">
              <Label htmlFor="automation-from">From (Addresses or Domains)</Label>
              <Textarea id="automation-from" rows={2} value={d.senders} onChange={(e) => set("senders", e.target.value)} placeholder="forms.example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-subject">Subject Contains</Label>
              <Textarea id="automation-subject" rows={2} value={d.subject} onChange={(e) => set("subject", e.target.value)} placeholder="New Enquiry" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-body">Body Contains</Label>
              <Textarea id="automation-body" rows={2} value={d.body} onChange={(e) => set("body", e.target.value)} />
            </div>
            {mail.length > 1 && (
              <div className="space-y-2">
                <Label>Email Accounts</Label>
                <p className="text-xs text-muted-foreground">Leave all unticked to look at every email account.</p>
                {mail.map((a) => (
                  <Check key={a.id} id={`automation-acc-${a.id}`} checked={d.accounts.includes(a.id)} onChange={(v) => set("accounts", v ? [...d.accounts, a.id] : d.accounts.filter((x) => x !== a.id))}>{a.nickname || a.detail || a.label}</Check>
                ))}
              </div>
            )}
          </fieldset>

          {custom && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Read</legend>
              <p className="text-xs text-muted-foreground">The AI fills in each of these from the email and leaves blank what is not there. It uses a little of your Automations share of AI usage.</p>
              {d.fields.map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Input aria-label="Field Name" className="w-32 shrink-0" value={f.label} maxLength={32} onChange={(e) => set("fields", d.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Name" />
                  <Input aria-label="What To Look For" value={f.description} maxLength={MAX_DESCRIPTION} onChange={(e) => set("fields", d.fields.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="What to look for" />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove Field" onClick={() => set("fields", d.fields.filter((_, j) => j !== i))}><X /></Button>
                </div>
              ))}
              {d.fields.length < MAX_FIELDS && <Button type="button" variant="ghost" onClick={() => set("fields", [...d.fields, { label: "", description: "" }])}><Plus /> Add Field</Button>}
            </fieldset>
          )}

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Do</legend>
            <Check id="do-contact" checked={d.contact} onChange={(v) => set("contact", v)}>Create or update the contact</Check>
            {d.contact && (
              <div className="ml-6 space-y-3">
                <Check id="do-lead" checked={d.lead} onChange={(v) => set("lead", v)}>Mark them a Lead</Check>
                {d.lead && (
                  <div className="space-y-2">
                    <Label htmlFor="do-source">Source</Label>
                    <Input id="do-source" value={d.source} maxLength={MAX_TEXT} onChange={(e) => set("source", e.target.value)} placeholder={d.name || "Website Enquiry"} />
                  </div>
                )}
                <Check id="do-link" checked={d.link} onChange={(v) => set("link", v)}>Link the email to their timeline</Check>
                <Check id="do-task" checked={d.task} onChange={(v) => set("task", v)}>Add a task</Check>
                {d.task && (
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Label htmlFor="do-task-title">Task</Label>
                      <Input id="do-task-title" value={d.taskTitle} maxLength={MAX_TEXT} onChange={(e) => set("taskTitle", e.target.value)} />
                    </div>
                    <div className="w-28 space-y-2">
                      <Label htmlFor="do-task-minutes">Due In (Minutes)</Label>
                      <Input id="do-task-minutes" inputMode="numeric" value={d.taskMinutes} onChange={(e) => set("taskMinutes", e.target.value.replace(/\D/g, ""))} />
                    </div>
                  </div>
                )}
              </div>
            )}
            <Check id="do-draft" checked={d.draft} onChange={(v) => set("draft", v)}>Write a reply draft to their own email address</Check>
            <Check id="do-urgent" checked={d.urgent} onChange={(v) => set("urgent", v)}>Send an urgent notification</Check>
          </fieldset>
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        </form>
        <div className={DIALOG_BUTTONS}>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" type="submit" form="automation-form" disabled={busy}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
