"use client";

// The More menu in the Contacts header: export every contact as a CSV or a vCard file (opened and written in the browser,
// so nothing readable goes through the server), and Import Contacts.

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { download } from "@/lib/compliance-export";
import { toCsv, toVcards } from "@/lib/contact-export";
import { loadExportContacts } from "@/lib/contact-transfer-io";
import { dayKey } from "@/lib/dates";
import { plural } from "@/lib/contact-list-helpers";
import { ImportContactsDialog } from "./import-dialog";

export function TransferMenu() {
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (kind: "csv" | "vcf") => {
    if (busy) return;
    setBusy(true);
    try {
      const contacts = await loadExportContacts();
      const day = dayKey(new Date());
      if (kind === "csv") download(`konva-contacts-${day}.csv`, "text/csv;charset=utf-8", `﻿${toCsv(contacts)}`);
      else download(`konva-contacts-${day}.vcf`, "text/vcard;charset=utf-8", toVcards(contacts));
      toast(`Exported ${plural(contacts.length, "contact")}.`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : "Export contacts failed");
      toast("Could not export your contacts. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button variant="secondary" size="icon" aria-label="More"><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max">
          <DropdownMenuItem onSelect={() => setImporting(true)}>Import Contacts</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={busy} onSelect={() => void save("csv")}>Export as CSV</DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => void save("vcf")}>Export as vCard</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ImportContactsDialog open={importing} onOpenChange={setImporting} />
    </>
  );
}
