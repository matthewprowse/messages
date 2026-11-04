"use client";

// Create, rename, recolour and delete labels. Any menu opens it with openManageLabels(); the lists and the open
// conversation each mount one host, and the latest mounted answers, so only one dialog ever shows.

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { LABEL_COLORS, labelDot, NAME_MAX, type Label, type LabelColor } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AutoLabelsSection } from "@/components/labels/auto-labels-section";

const OPEN_EVENT = "konva:manage-labels";
// Hosts in mount order: a header opened beside the list mounts later, and is the one that answers.
const hosts: symbol[] = [];

/** Opens the Manage Labels dialog from anywhere. */
export function openManageLabels() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function ColorSelect({ value, onChange, label }: { value: LabelColor; onChange: (c: LabelColor) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as LabelColor)}>
      <SelectTrigger aria-label={label} className="w-32 data-[size=default]:h-8"><SelectValue /></SelectTrigger>
      <SelectContent>
        {LABEL_COLORS.map((c) => (
          <SelectItem key={c} value={c}>
            <span className="flex items-center gap-2"><span className={cn("size-2 rounded-full", labelDot(c))} aria-hidden />{c[0].toUpperCase() + c.slice(1)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LabelRow({ label }: { label: Label }) {
  const { labels: api } = useApp();
  const [name, setName] = useState(label.name);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setName(label.name); }, [label.name]);
  const save = async () => {
    if (name.trim() === label.name) return;
    // An empty or taken name puts the old one back.
    if (!(await api.updateLabel(label.id, { name }))) setName(label.name);
  };
  return (
    <div className="flex items-center gap-2">
      <Input value={name} maxLength={NAME_MAX} aria-label="Label Name" className="h-8 min-w-0 flex-1" onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <ColorSelect value={label.color} label={`Colour of ${label.name}`} onChange={(color) => api.updateLabel(label.id, { color })} />
      {confirm
        ? <Button type="button" variant="secondary" onClick={() => api.deleteLabel(label.id)} onBlur={() => setConfirm(false)}>Delete</Button>
        : <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${label.name}`} onClick={() => setConfirm(true)}><Trash2 /></Button>}
    </div>
  );
}

/** The dialog and the listener that opens it. */
export function ManageLabelsHost() {
  const { labels: api } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const me = useRef(Symbol("manage-labels"));
  useEffect(() => {
    const id = me.current;
    hosts.push(id);
    const show = () => { if (hosts[hosts.length - 1] === id) setOpen(true); };
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      hosts.splice(hosts.indexOf(id), 1);
    };
  }, []);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await api.createLabel(name)) setName("");
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Labels</DialogTitle>
          <DialogDescription>Labels are private to you and stored encrypted. Deleting one takes it off every conversation.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {api.labels.length === 0 && <p className="text-sm text-muted-foreground">No labels yet. Name your first one below.</p>}
          {api.labels.map((l) => <LabelRow key={l.id} label={l} />)}
        </div>
        <form onSubmit={add} className="flex items-center gap-2">
          <Input value={name} maxLength={NAME_MAX} placeholder="New Label" aria-label="New Label" className="h-8 flex-1" onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={!name.trim()}>Add</Button>
        </form>
        <AutoLabelsSection labels={api.labels} active={open} />
      </DialogContent>
    </Dialog>
  );
}
