"use client";

import { useContext, useState } from "react";
import { markSubmitted } from "@/lib/analytics";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { renameCompany, type CompanyDetail } from "@/lib/organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CompanyAvatar, ContactAvatar, EmptyState } from "@/components/primitives";
import { formatPhone, niceName } from "@/lib/format";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { CompaniesContext } from "@/components/contacts-shell";
import { ConversationRows, DetailList, DetailPage, Divided, ListRow, Section } from "@/components/contact-list";
import { withQuery } from "@/lib/utils";

// Mounted only while the dialog is open, so it starts from the current name every time.
function RenameForm({ company, onDone, onRenamed }: { company: CompanyDetail; onDone: () => void; onRenamed: (name: string) => void }) {
  const [name, setName] = useState(company.name);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const ready = !saving && trimmed.length > 0 && trimmed !== company.name;

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      await renameCompany(company.id, trimmed);
      markSubmitted("rename_company");
      onRenamed(trimmed);
      onDone();
    } catch (err) {
      console.error(err instanceof Error ? err.message : "Rename company failed");
      toast("Could not rename the company. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="grid gap-2">
        <Label htmlFor="company-name">Name</Label>
        <Input id="company-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={saving} autoFocus />
      </div>
      <div className={DIALOG_BUTTONS}>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="secondary" disabled={!ready}>{saving ? "Saving" : "Save"}</Button>
      </div>
    </form>
  );
}

export function CompanyView({ company: loaded }: { company: CompanyDetail | null }) {
  const query = useSearchParams().toString();
  const notifyList = useContext(CompaniesContext);
  // The page reloads the company after a merge or delete; a rename shows at once, before that reload.
  const [renamed, setRenamed] = useState<string | null>(null);
  const company = loaded && renamed ? { ...loaded, name: renamed } : loaded;
  const [renaming, setRenaming] = useState(false);

  if (!company) {
    return <EmptyState icon={Building2} title="Company Not Found" description="It may have been removed." action={<Button variant="outline" asChild><Link href="/contacts?view=companies">Back to Companies</Link></Button>} />;
  }

  const addresses = company.people.reduce((n, p) => n + p.emails.length, 0);

  return (
    // Same structure as a contact: the header sticks to the scroll area and content scrolls underneath it.
    <DetailPage
      backHref={`/contacts?${query || "view=companies"}`}
      header={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <CompanyAvatar logoPath={company.logoPath} className="size-8" />
            <div className="flex min-w-0 flex-col">
              <h1 className="truncate text-sm font-medium">{company.name}</h1>
              <span className="truncate text-xs text-muted-foreground">{company.domain}</span>
            </div>
          </div>
          <Button variant="secondary" onClick={() => setRenaming(true)}>Rename</Button>
          <Dialog open={renaming} onOpenChange={setRenaming}>
            <DialogContent track="rename_company" className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Rename Company</DialogTitle>
                <DialogDescription>Everyone at {company.domain} stays filed under it.</DialogDescription>
              </DialogHeader>
              <RenameForm
                company={company}
                onDone={() => setRenaming(false)}
                onRenamed={(name) => {
                  setRenamed(name);
                  notifyList(company.id, name);
                }}
              />
            </DialogContent>
          </Dialog>
        </>
      }
    >
      {company.summary && (
        <Section title="Summary">
          <p className="text-sm leading-6 text-muted-foreground">{company.summary}</p>
        </Section>
      )}

      <Section title="Details">
        <DetailList
          items={[
            { label: "Domain", value: company.domain },
            { label: "Addresses", value: String(addresses) },
            { label: "Conversations", value: String(company.conversations.length) },
          ]}
        />
      </Section>

      <Section title="People">
        <div className="-mx-3 flex flex-col gap-2">
          <Divided className="pr-3 pl-14">
            {company.people.map((p) => (
              <ListRow
                key={p.id}
                href={withQuery(`/contacts/${p.id}`, query)}
                avatar={<ContactAvatar contact={{ avatarPath: p.avatarPath, isCompany: false }} className="size-8" />}
                title={niceName(p.name)}
                detail={[p.role, ...p.emails, ...p.phones.map(formatPhone)].filter(Boolean).join(" · ")}
              />
            ))}
          </Divided>
        </div>
      </Section>

      <Section title="Conversations">
        {company.conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conversations yet.</p>
        ) : (
          <ConversationRows items={company.conversations} avatar={<CompanyAvatar logoPath={company.logoPath} className="size-8" />} />
        )}
      </Section>
    </DetailPage>
  );
}
