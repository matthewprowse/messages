"use client";

// The New Contact dialog: the shared fields, saved with createContact, then the new person's page opens.

import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { markSubmitted } from "@/lib/analytics";
import { createContact } from "@/lib/contacts";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { ContactFields, useContactFields } from "./contact-fields";

// Mounted only while the dialog is open, so it starts empty every time.
function NewContactForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { refreshContacts } = useApp();
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ text: string; existingId?: string } | null>(null);
  // Changing what clashed clears the message.
  const fields = useContactFields({}, () => setFailure(null));

  const open = (id: string) => {
    onDone();
    router.push(`/contacts/${id}`);
  };

  const submit = async () => {
    setTried(true);
    if (!fields.valid || saving) return;
    setSaving(true);
    setFailure(null);
    let result: Awaited<ReturnType<typeof createContact>>;
    try {
      result = await createContact({
        name: fields.values.name.trim(),
        emails: fields.emails.map((e) => e.trim().toLowerCase()).filter(Boolean),
        phones: fields.phoneValues.filter((p): p is string => !!p),
        company: fields.values.company.trim(),
        role: fields.values.role.trim(),
        relationship: fields.values.relationship.trim(),
      });
    } catch {
      setFailure({ text: "Could not add the contact. Check your connection and try again." });
      return;
    } finally {
      setSaving(false);
    }
    if (!result.ok) {
      setFailure({ text: result.error, existingId: result.existingId });
      return;
    }
    markSubmitted("new_contact");
    if (result.warning) toast(result.warning);
    open(result.id);
    // The list and the rest of the app pick the new person up in the background.
    void refreshContacts([]);
  };

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <ContactFields idPrefix="new-contact" fields={fields} tried={tried} disabled={saving} />
      {failure && <p role="alert" className="text-sm text-destructive">{failure.text}</p>}
      <div className={DIALOG_BUTTONS}>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {failure?.existingId && (
          <Button type="button" variant="secondary" onClick={() => open(failure.existingId!)}>Open Contact</Button>
        )}
        <Button type="submit" variant="secondary" disabled={saving}>{saving ? "Saving" : "Save"}</Button>
      </div>
    </form>
  );
}

export function NewContactDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track="new_contact" showCloseButton={false} aria-describedby={undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Contact</DialogTitle>
        </DialogHeader>
        <NewContactForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
