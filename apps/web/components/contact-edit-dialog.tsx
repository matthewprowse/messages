"use client";

// The Edit Contact dialog on a contact's page. The form fields are shared with New Contact (contact-list.tsx).

import { useMemo, useState } from "react";
import { identityGroups } from "@/lib/merging";
import { markSubmitted } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { updateContact, type ContactDetail } from "@/lib/contacts";
import { useApp } from "@/lib/store";
import { formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { ContactFields, useContactFields } from "@/components/contact-list";

/** Edit Contact: their name, company, role and relationship, and their email addresses and phone numbers. */
export function EditContactDialog({ contact, open, onOpenChange }: { contact: ContactDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track="edit_contact" showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Contact</DialogTitle>
          <DialogDescription>A name you set here stays, even when their address book or WhatsApp name changes.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so it starts from the contact as it is now. */}
        {open && <EditContactForm contact={contact} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditContactForm({ contact, onDone }: { contact: ContactDetail; onDone: () => void }) {
  const router = useRouter();
  const { refreshContacts } = useApp();
  // Their current addresses and numbers, one row each, whichever way they are stored: a number that is only a WhatsApp
  // identity can be removed too, and removing a number takes its phone and WhatsApp entries together. A WhatsApp-only
  // privacy ID is not shown (it is not a number), and Instagram and LinkedIn are shown on the contact's page, not here.
  const existing = useMemo(() => identityGroups(contact.identityRows).filter((g) => !g.social && g.label !== "WhatsApp"), [contact.identityRows]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ text: string; existingId?: string } | null>(null);
  const fields = useContactFields(
    { name: contact.name, company: contact.company ?? "", role: contact.role ?? "", relationship: contact.relationship ?? "" },
    () => setFailure(null),
  );

  const submit = async () => {
    setTried(true);
    if (!fields.valid || saving) return;
    setSaving(true);
    setFailure(null);
    const result = await updateContact(contact.id, {
      name: fields.values.name.trim(),
      company: fields.values.company,
      role: fields.values.role,
      relationship: fields.values.relationship,
      addEmails: fields.emails.map((e) => e.trim().toLowerCase()).filter(Boolean),
      addPhones: fields.phoneValues.filter((p): p is string => !!p),
      remove: removed,
    });
    setSaving(false);
    if (!result.ok) {
      setFailure({ text: result.error, existingId: result.existingId });
      return;
    }
    markSubmitted("edit_contact");
    onDone();
    // Reloads this contact page and their name everywhere else in the app.
    void refreshContacts([contact.id]);
  };

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      <ContactFields
        idPrefix="edit-contact"
        fields={fields}
        tried={tried}
        disabled={saving}
        editing
        existing={
          existing.length > 0 && (
            <div className="grid gap-2">
              <Label>Addresses and Numbers</Label>
              {existing.map((g) => {
                const gone = g.ids.every((id) => removed.includes(id));
                const text = g.detail === "Email" ? g.label : formatPhone(g.label);
                return (
                  <div key={g.ids.join(",")} className="flex items-center gap-2">
                    <span className={gone ? "min-w-0 flex-1 truncate text-sm text-muted-foreground line-through" : "min-w-0 flex-1 truncate text-sm"}>
                      {text}
                    </span>
                    {gone ? (
                      <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setRemoved(removed.filter((id) => !g.ids.includes(id)))}>Undo</Button>
                    ) : (
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${text}`} disabled={saving} onClick={() => setRemoved([...removed, ...g.ids])}><X /></Button>
                    )}
                  </div>
                );
              })}
            </div>
          )
        }
      />
      {failure && <p role="alert" className="text-sm text-destructive">{failure.text}</p>}
      <div className={DIALOG_BUTTONS}>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {failure?.existingId && (
          <Button type="button" variant="secondary" onClick={() => { onDone(); router.push(`/contacts/${failure.existingId}`); }}>Open Contact</Button>
        )}
        <Button type="submit" variant="secondary" disabled={saving}>{saving ? "Saving" : "Save"}</Button>
      </div>
    </form>
  );
}
