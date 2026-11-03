"use client";

// New Matter and Rename Matter: a short name and what kind of job it is. The name is sealed when saved (lib/timeline/matters-io.ts).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { checkMatterName, KIND_LABEL, MATTER_KINDS, MATTER_NAME_MAX, type Matter, type MatterKind } from "@/lib/timeline/matters";

export function MatterDialog({ open, onOpenChange, matter, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; matter?: Matter; onSave: (name: string, kind: MatterKind) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track="matter" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{matter ? "Rename Matter" : "New Matter"}</DialogTitle>
          <DialogDescription>A deal, listing, policy or matter for this client. Add conversations, notes and files to it to see just that job.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so it starts from the matter as it is now. */}
        {open && <MatterForm matter={matter} onSave={(n, k) => { onSave(n, k); onOpenChange(false); }} />}
      </DialogContent>
    </Dialog>
  );
}

function MatterForm({ matter, onSave }: { matter?: Matter; onSave: (name: string, kind: MatterKind) => void }) {
  const [name, setName] = useState(matter?.name ?? "");
  const [kind, setKind] = useState<MatterKind>(matter?.kind ?? "matter");
  const [tried, setTried] = useState(false);
  const check = checkMatterName(name);
  const submit = () => {
    setTried(true);
    if (check.name) onSave(check.name, kind);
  };
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Input autoFocus value={name} maxLength={MATTER_NAME_MAX + 10} placeholder="12 Oak Street Sale" aria-label="Name" aria-invalid={tried && !!check.error} onChange={(e) => setName(e.target.value)} />
      {tried && check.error && <p className="text-xs text-destructive">{check.error}</p>}
      <Select value={kind} onValueChange={(v) => setKind(v as MatterKind)}>
        <SelectTrigger aria-label="Kind"><SelectValue /></SelectTrigger>
        <SelectContent>{MATTER_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
      </Select>
      <DialogFooter>
        <Button type="submit">{matter ? "Save" : "Create"}</Button>
      </DialogFooter>
    </form>
  );
}
