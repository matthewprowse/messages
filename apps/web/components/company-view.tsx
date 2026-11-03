"use client";

// A company's page under Contacts, laid out like a contact's: the header with Rename, then on the grey the numbers
// (addresses, conversations), its summary, its people and its conversations. A rename is reported to the list.

import { useContext, useState } from "react";
import { markSubmitted } from "@/lib/analytics";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { renameCompany, type CompanyDetail } from "@/lib/organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CompanyAvatar, ContactAvatar, EmptyState } from "@/components/primitives";
import { formatPhone, niceName } from "@/lib/format";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { CompaniesContext } from "@/components/contacts-shell";
import { ConversationRows, DetailHeading, DetailPage } from "@/components/contact-list";
import { Card, Row, Separated, StatCard } from "@/components/surface";
import { IconAction } from "@/components/tip";
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
    return <EmptyState icon={Building2} title="Company Not Found" action={<Button variant="secondary" asChild><Link href="/contacts?view=companies">Back to Companies</Link></Button>} />;
  }

  const addresses = company.people.reduce((n, p) => n + p.emails.length, 0);
  const logo = <CompanyAvatar logoPath={company.logoPath} className="size-10" />;

  return (
    <DetailPage
      backHref={`/contacts?${query || "view=companies"}`}
      header={
        <>
          <DetailHeading avatar={logo} title={company.name} subtitle={company.domain} />
          <div className="flex shrink-0 items-center gap-1">
            <IconAction label="Rename" icon={Pencil} onClick={() => setRenaming(true)} />
          </div>
          <Dialog open={renaming} onOpenChange={setRenaming}>
            <DialogContent track="rename_company" showCloseButton={false} aria-describedby={undefined} className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Rename Company</DialogTitle>
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
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Addresses" value={addresses} />
        <StatCard label="Conversations" value={company.conversations.length} />
      </div>

      {company.summary && (
        <Card title="Summary">
          <p className="px-3 pb-3 text-sm leading-6">{company.summary}</p>
        </Card>
      )}

      {company.people.length > 0 && (
        <Card title="People">
          <Separated>
            {company.people.map((p) => (
              <Row
                key={p.id}
                href={withQuery(`/contacts/${p.id}`, query)}
                lead={<ContactAvatar contact={{ avatarPath: p.avatarPath, isCompany: false }} className="size-10" />}
                title={niceName(p.name)}
                detail={p.role || p.emails[0] || (p.phones[0] ? formatPhone(p.phones[0]) : undefined)}
              />
            ))}
          </Separated>
        </Card>
      )}

      {company.conversations.length > 0 && (
        <Card title="Conversations">
          <ConversationRows items={company.conversations} avatar={logo} />
        </Card>
      )}
    </DetailPage>
  );
}
