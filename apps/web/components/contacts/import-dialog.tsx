"use client";

// Import Contacts: pick a vCard or CSV file, see what it would do (add new people, add details to people already here,
// skip rows), then confirm. Nothing is saved until Import is pressed. The reading and matching is lib/contact-import.ts.

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { useContactsData } from "@/components/contacts-data";
import { MAX_IMPORT_ROWS, parseContactFile, planImport, summarisePlan, type ImportItem } from "@/lib/contact-import";
import { applyImport, type ImportResult } from "@/lib/contact-transfer-io";
import { defaultCountryCode } from "@/lib/new-items";
import { plural } from "@/lib/contact-list-helpers";
import { niceName } from "@/lib/format";
import { useApp } from "@/lib/store";

// A phone's contact export is a few hundred kilobytes; this stops a wrong file from being read whole.
const MAX_FILE_BYTES = 5_000_000;
// Rows drawn in the preview; the counts above it cover them all.
const PREVIEW_ROWS = 100;

const BADGE: Record<ImportItem["action"], { label: string; variant: "secondary" | "outline" }> = {
  create: { label: "New", variant: "secondary" },
  merge: { label: "Adds To", variant: "outline" },
  skip: { label: "Skipped", variant: "outline" },
};

function ImportForm({ onDone }: { onDone: () => void }) {
  const { contacts } = useContactsData();
  const { accounts, refreshContacts } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const country = useMemo(() => defaultCountryCode(accounts), [accounts]);
  const counts = plan ? summarisePlan(plan) : null;
  const todo = counts ? counts.create + counts.merge : 0;

  const read = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setPlan(null);
    if (file.size > MAX_FILE_BYTES) return setProblem("This file is too big. Export fewer contacts and try again.");
    const rows = parseContactFile(await file.text());
    if (rows.length === 0) return setProblem("No contacts found. Use a vCard (.vcf) file, or a CSV with a header row that has Name, Email or Phone columns.");
    if (rows.length > MAX_IMPORT_ROWS) return setProblem(`This file has ${rows.length} contacts. Import up to ${MAX_IMPORT_ROWS} at a time.`);
    setPlan(planImport(rows, (contacts ?? []).map((c) => ({ id: c.id, name: c.name, emails: c.emails, phones: c.phones })), country));
  };

  const run = async () => {
    if (!plan || progress !== null) return;
    setProgress(0);
    const done = await applyImport(plan, setProgress);
    setProgress(null);
    setResult(done);
    toast(`Imported ${plural(done.created + done.merged, "contact")}.`);
    // The list and the rest of the app pick the changes up in the background.
    void refreshContacts([]);
  };

  if (result) {
    return (
      <div className="grid gap-4">
        <p className="text-sm">{plural(result.created, "person", "people")} added and details added to {plural(result.merged, "person", "people")}.</p>
        {result.failed.length > 0 && (
          <div role="alert" className="grid gap-1 text-sm text-destructive">
            <p>{plural(result.failed.length, "row")} could not be saved:</p>
            <ul className="list-disc pl-5">{result.failed.slice(0, 10).map((f, i) => <li key={i}>{f}</li>)}</ul>
          </div>
        )}
        <div className={DIALOG_BUTTONS}><Button type="button" variant="secondary" onClick={onDone}>Done</Button></div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <input ref={input} type="file" accept=".vcf,.vcard,.csv,text/vcard,text/csv" className="sr-only" aria-label="Contacts File" onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ""; }} />
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      {plan && counts && (
        <>
          <p className="text-sm text-muted-foreground">{plural(counts.create, "new person", "new people")}, {plural(counts.merge, "person", "people")} to add details to, {plural(counts.skip, "row")} skipped.</p>
          <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {plan.slice(0, PREVIEW_ROWS).map((item, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{niceName(item.name) || "No Name"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.action === "merge" ? `${niceName(item.target?.name ?? "")}${item.emails.length + item.phones.length ? `: adds ${plural(item.emails.length + item.phones.length, "detail")}` : ""}` : item.note ?? [...item.emails, ...item.phones][0] ?? ""}
                  </p>
                </div>
                <Badge variant={BADGE[item.action].variant}>{BADGE[item.action].label}</Badge>
              </li>
            ))}
          </ul>
            </>
      )}
      <div className={DIALOG_BUTTONS}>
        <Button type="button" variant="ghost" onClick={onDone} disabled={progress !== null}>Cancel</Button>
        {plan ? (
          <>
            <Button type="button" variant="ghost" onClick={() => input.current?.click()} disabled={progress !== null}>Choose Another File</Button>
            <Button type="button" variant="secondary" disabled={todo === 0 || progress !== null} onClick={() => void run()}>{progress !== null ? `Importing ${progress} of ${plan.length}` : `Import ${plural(todo, "Contact")}`}</Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={() => input.current?.click()}>Choose File</Button>
        )}
      </div>
    </div>
  );
}

export function ImportContactsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open, so it starts empty every time. */}
        {open && <ImportForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
