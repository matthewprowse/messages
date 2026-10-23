"use client";

import { Children, Fragment, isValidElement, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Building2, Combine, Plus, Users, X } from "lucide-react";
import { createContact, type ContactSummary } from "@/lib/contacts";
import type { CompanySummary } from "@/lib/organizations";
import { isCompanySender } from "@/lib/people";
import { defaultCountryCode, normalisePhone, PHONE_HINT } from "@/lib/new-items";
import { isEmail } from "@/lib/send-from";
import { useApp } from "@/lib/store";
import { relTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Badge } from "@/components/ui/badge";
import { useContactsData } from "@/components/contacts-data";
import { formatPhone } from "@/lib/format";

// ---------------------------------------------------------------------------
// Pieces shared by the Contacts pages: the list, a contact, a company and Suggested Merges.
// ---------------------------------------------------------------------------

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function withQuery(path: string, query: string) {
  return query ? `${path}?${query}` : path;
}

/** Children with a separator between each, inset to line up with the text when className says so. */
export function Divided({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <>
      {Children.toArray(children).map((child, i) => (
        <Fragment key={isValidElement(child) && child.key != null ? child.key : i}>
          {i > 0 && (className ? <div className={className}><Separator /></div> : <Separator />)}
          {child}
        </Fragment>
      ))}
    </>
  );
}

/** A row as in the Conversations list: an optional avatar, a name line and a detail line. */
export function ListRow({
  href,
  avatar,
  title,
  at,
  aside,
  detail,
  selected = false,
  className,
}: {
  href: string;
  avatar?: React.ReactNode;
  title: string;
  /** Shown on the right as a relative time. */
  at?: string | null;
  /** Shown on the right instead of a time. */
  aside?: React.ReactNode;
  /** Leave undefined for no detail line; an empty string keeps the row's height. */
  detail?: string;
  selected?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("flex items-center gap-3 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", selected ? "bg-muted" : "hover:bg-muted/50", className)}
    >
      {avatar && <div className={cn("shrink-0", selected && "[&_[data-slot=avatar-fallback]]:bg-background")}>{avatar}</div>}
      {/* 20px name line + 4px gap + 16px detail line = 40px, the avatar's height. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-5 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium">{title}</span>
          {aside ?? (at && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relTime(at, new Date())}</span>)}
        </div>
        {detail !== undefined && (
          <div className="flex h-4 items-center">
            <span className="min-w-0 truncate text-xs">{detail}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** Label and value rows in a bordered box, as on a contact's and a company's page. */
export function DetailList({ items }: { items: { label: string; value: string; href?: string }[] }) {
  return (
    <div className="rounded-lg border px-4">
      <Divided>
        {items.map((d) => (
          <div key={`${d.label}-${d.value}`} className="flex items-center justify-between gap-6 py-3">
            <span className="shrink-0 text-xs text-muted-foreground">{d.label}</span>
            {d.href ? (
              <Link href={d.href} className="min-w-0 truncate text-sm underline-offset-2 hover:underline">{d.value}</Link>
            ) : (
              <span className="min-w-0 truncate text-sm">{d.value}</span>
            )}
          </div>
        ))}
      </Divided>
    </div>
  );
}

/** The right-hand page: a header that sticks to the scroll area, with Back on phones, and content under it. */
export function DetailPage({ backHref, header, children, className = "space-y-8" }: { backHref: string; header: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <ScrollArea className="h-full" scrollbarClassName="data-vertical:top-16! data-vertical:h-auto!">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-background/70 p-3 backdrop-blur-xl backdrop-saturate-150 md:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Back">
          <Link href={backHref}><ArrowLeft /></Link>
        </Button>
        {header}
      </header>
      <div className="p-3 md:px-4">
        <div className={cn("mx-auto w-full max-w-2xl", className)}>{children}</div>
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// New Contact
// ---------------------------------------------------------------------------

/** A few lines of the same kind (addresses or numbers), with Add and Remove. */
function MultiInput({ id, label, addLabel, values, errors, onChange, disabled, type }: {
  id: string;
  label: string;
  addLabel: string;
  values: string[];
  errors: (string | null)[];
  onChange: (values: string[]) => void;
  disabled: boolean;
  type: "email" | "tel";
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${id}-0`}>{label}</Label>
      {values.map((v, i) => (
        <div key={i} className="grid gap-1">
          <div className="flex items-center gap-2">
            <Input
              id={`${id}-${i}`}
              type={type}
              value={v}
              onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
              maxLength={254}
              disabled={disabled}
              aria-invalid={!!errors[i]}
            />
            {values.length > 1 && (
              <Button type="button" variant="ghost" size="icon" aria-label="Remove" disabled={disabled} onClick={() => onChange(values.filter((_, j) => j !== i))}>
                <X />
              </Button>
            )}
          </div>
          {errors[i] && <p className="text-xs text-destructive">{errors[i]}</p>}
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" className="justify-self-start" disabled={disabled} onClick={() => onChange([...values, ""])}>
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}

// Mounted only while the dialog is open, so it starts empty every time.
function NewContactForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { accounts, refreshContacts } = useApp();
  const country = useMemo(() => defaultCountryCode(accounts), [accounts]);
  const [name, setName] = useState("");
  const [emails, setEmails] = useState([""]);
  const [phones, setPhones] = useState([""]);
  const [company, setCompany] = useState("");
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ text: string; existingId?: string } | null>(null);

  const emailErrors = emails.map((e) => (e.trim() && !isEmail(e) ? "Check this address." : null));
  const phoneValues = phones.map((p) => (p.trim() ? normalisePhone(p, country) : null));
  const phoneErrors = phones.map((p, i) => (p.trim() && !phoneValues[i] ? PHONE_HINT : null));
  const nameError = name.trim() ? null : "Add a name.";
  const valid = !nameError && !emailErrors.some(Boolean) && !phoneErrors.some(Boolean);

  const open = (id: string) => {
    onDone();
    router.push(`/contacts/${id}`);
  };

  const submit = async () => {
    setTried(true);
    if (!valid || saving) return;
    setSaving(true);
    setFailure(null);
    const result = await createContact({
      name: name.trim(),
      emails: emails.map((e) => e.trim().toLowerCase()).filter(Boolean),
      phones: phoneValues.filter((p): p is string => !!p),
      company: company.trim(),
    });
    setSaving(false);
    if (!result.ok) {
      setFailure({ text: result.error, existingId: result.existingId });
      return;
    }
    open(result.id);
    // The list and the rest of the app pick the new person up in the background.
    void refreshContacts([]);
  };

  // Changing what clashed clears the message.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setFailure(null);
  };

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <div className="grid gap-2">
        <Label htmlFor="new-contact-name">Name</Label>
        <Input id="new-contact-name" value={name} onChange={(e) => edit(setName)(e.target.value)} maxLength={120} disabled={saving} aria-invalid={tried && !!nameError} autoFocus />
        {tried && nameError && <p className="text-xs text-destructive">{nameError}</p>}
      </div>
      <MultiInput id="new-contact-email" label="Email Addresses" addLabel="Add Email Address" type="email" values={emails} errors={tried ? emailErrors : []} onChange={edit(setEmails)} disabled={saving} />
      <MultiInput id="new-contact-phone" label="Phone Numbers" addLabel="Add Phone Number" type="tel" values={phones} errors={tried ? phoneErrors : []} onChange={edit(setPhones)} disabled={saving} />
      <div className="grid gap-2">
        <Label htmlFor="new-contact-company">Company</Label>
        <Input id="new-contact-company" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} disabled={saving} placeholder="Optional" />
      </div>
      {failure && <p role="alert" className="text-sm text-destructive">{failure.text}</p>}
      <div className={DIALOG_BUTTONS}>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        {failure?.existingId && (
          <Button type="button" variant="secondary" onClick={() => open(failure.existingId!)}>Open Contact</Button>
        )}
        <Button type="submit" disabled={saving}>{saving ? "Saving" : "Save"}</Button>
      </div>
    </form>
  );
}

function NewContactDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Contact</DialogTitle>
          <DialogDescription>Add someone with any of their email addresses and phone numbers.</DialogDescription>
        </DialogHeader>
        <NewContactForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

type Sort = "recent" | "name";
type View = "people" | "companies";

function queryOf(sort: Sort, view: View) {
  return [view === "companies" ? "view=companies" : "", sort === "name" ? "sort=name" : ""].filter(Boolean).join("&");
}

function useSort(): { sort: Sort; view: View; query: string } {
  const params = useSearchParams();
  const sort: Sort = params.get("sort") === "name" ? "name" : "recent";
  const view: View = params.get("view") === "companies" ? "companies" : "people";
  return { sort, view, query: queryOf(sort, view) };
}

function detailOf(c: ContactSummary) {
  const work = [c.role, c.company].filter(Boolean).join(", ");
  return work || c.emails[0] || (c.phones[0] ? formatPhone(c.phones[0]) : "");
}

function bySort(sort: Sort) {
  return (a: { name: string; lastAt: string | null }, b: { name: string; lastAt: string | null }) =>
    sort === "name" ? a.name.localeCompare(b.name) : (b.lastAt ?? "").localeCompare(a.lastAt ?? "") || a.name.localeCompare(b.name);
}

function LoadingRows({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2" aria-label={label}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Loading rows, a reason it is empty, or the rows with separators between them. */
function ListBody({ items, label, icon, failed, empty, children }: {
  items: unknown[] | null | undefined;
  label: string;
  icon: typeof Users;
  failed: string;
  empty: { title: string; description: string };
  children: React.ReactNode;
}) {
  if (items === undefined) return <LoadingRows label={label} />;
  if (Children.count(children) === 0) {
    return (
      <div className="py-24">
        {items === null ? (
          <EmptyState icon={icon} title={failed} description="Check your connection, then reload." />
        ) : (
          <EmptyState icon={icon} title={empty.title} description={empty.description} />
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Divided className="pl-16">{children}</Divided>
    </div>
  );
}

export function ContactList({ contacts, companies }: { contacts: ContactSummary[] | null | undefined; companies: CompanySummary[] | null | undefined }) {
  const { sort, view, query } = useSort();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();
  const { suggestions } = useContactsData();
  const [adding, setAdding] = useState(false);
  // Brands and role senders (noreply@, info@) are listed under Companies, not People.
  const people = useMemo(() => (contacts ?? []).filter((c) => !isCompanySender(c)).sort(bySort(sort)), [contacts, sort]);
  const sortedCompanies = useMemo(() => [...(companies ?? [])].sort(bySort(sort)), [companies, sort]);
  const go = (nextSort: Sort, nextView: View) => router.push(withQuery("/contacts", queryOf(nextSort, nextView)));

  return (
    // The scrollbar starts below the 104px floating header instead of running behind it.
    <ScrollArea className="h-full" scrollbarClassName="data-vertical:top-[104px]! data-vertical:h-auto!">
      {/* Rows scroll underneath this header and show through it faintly. */}
      <div className="sticky top-0 z-10 space-y-2 bg-background/70 p-3 backdrop-blur-xl backdrop-saturate-150">
        <div className="flex h-10 items-center justify-between gap-2">
          <h1 className="text-lg font-medium">Contacts</h1>
          <Button variant="secondary" onClick={() => setAdding(true)}>New Contact</Button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Tabs value={view} onValueChange={(v) => go(sort, v as View)}>
            <TabsList aria-label="Show">
              <TabsTrigger value="people" className="px-3">People</TabsTrigger>
              <TabsTrigger value="companies" className="px-3">Companies</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={sort} onValueChange={(v) => go(v as Sort, view)}>
            <TabsList aria-label="Sort">
              <TabsTrigger value="recent" className="px-3">Recent</TabsTrigger>
              <TabsTrigger value="name" className="px-3">Name</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      <NewContactDialog open={adding} onOpenChange={setAdding} />
      <div className="px-3 pb-3">
        {view === "companies" ? (
          <ListBody
            items={companies}
            label="Loading companies"
            icon={Building2}
            failed="Companies Did Not Load"
            empty={{ title: "No Companies Yet", description: "People who write from a work address are grouped here by company." }}
          >
            {sortedCompanies.map((c) => (
              <ListRow
                key={c.id}
                href={withQuery(`/contacts/companies/${c.id}`, query)}
                avatar={<ContactAvatar contact={{ avatarPath: c.avatarPath }} className="size-10" />}
                title={c.name}
                at={c.lastAt}
                detail={[c.domain, plural(c.addresses, "address", "addresses"), plural(c.conversations, "conversation")].join(" · ")}
                selected={params.id === c.id}
                className="scroll-mt-[104px]"
              />
            ))}
          </ListBody>
        ) : (
          <>
            {/* Shown above People while there are likely duplicates to review. */}
            {!!suggestions?.length && (
              <>
                <ListRow
                  href={withQuery("/contacts/merges", query)}
                  avatar={
                    <div className={cn("flex size-10 items-center justify-center rounded-full", pathname === "/contacts/merges" ? "bg-background" : "bg-muted")}>
                      <Combine className="size-4" />
                    </div>
                  }
                  title="Suggested Merges"
                  aside={<Badge variant="secondary">{suggestions.length}</Badge>}
                  detail={`${plural(suggestions.length, "pair")} that may be the same person`}
                  selected={pathname === "/contacts/merges"}
                />
                <div className="my-2 pl-16"><Separator /></div>
              </>
            )}
            <ListBody
              items={contacts}
              label="Loading contacts"
              icon={Users}
              failed="Contacts Did Not Load"
              empty={{ title: "No Contacts Yet", description: "People appear here as your accounts sync." }}
            >
              {people.map((c) => (
                <ListRow
                  key={c.id}
                  href={withQuery(`/contacts/${c.id}`, query)}
                  avatar={<ContactAvatar contact={c} className="size-10" />}
                  title={c.name}
                  at={c.lastAt}
                  detail={detailOf(c)}
                  selected={params.id === c.id}
                  className="scroll-mt-[104px]"
                />
              ))}
            </ListBody>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
