"use client";

import { Children, Fragment, isValidElement, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { markSubmitted } from "@/lib/analytics";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUpDown, Building2, Combine, Mail, MessageCircle, Plus, Users, X } from "lucide-react";
import { checkContactFields, createContact, type ContactConversation, type ContactSummary } from "@/lib/contacts";
import type { CompanySummary } from "@/lib/organizations";
import { isCompanySender } from "@/lib/people";
import { defaultCountryCode } from "@/lib/new-items";
import { useApp } from "@/lib/store";
import { formatPhone, relTime } from "@/lib/format";
import { cn, withQuery } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { ProviderLogo } from "@/components/provider-logo";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Badge } from "@/components/ui/badge";
import { useContactsData } from "@/components/contacts-data";

// ---------------------------------------------------------------------------
// Pieces shared by the Contacts pages: the list, a contact, a company and Suggested Merges.
// ---------------------------------------------------------------------------

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Their first address, or else their first number formatted for display. */
export function firstReach(c: { emails: string[]; phones: string[] }) {
  return c.emails[0] ?? (c.phones[0] ? formatPhone(c.phones[0]) : "");
}

/** Most recent conversation first, then by name. */
export function byRecent(a: { name: string; lastAt: string | null }, b: { name: string; lastAt: string | null }) {
  return (b.lastAt ?? "").localeCompare(a.lastAt ?? "") || a.name.localeCompare(b.name);
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
  badge,
  at,
  aside,
  detail,
  selected = false,
  className,
}: {
  href: string;
  avatar?: React.ReactNode;
  title: string;
  /** Shown just after the title, such as the service a conversation comes from. */
  badge?: React.ReactNode;
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
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium">{title}</span>
            {badge}
          </span>
          {aside ??(at && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relTime(at, new Date())}</span>)}
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
export function DetailList({ items }: { items: { label: string; value: string; href?: string; onSelect?: () => void }[] }) {
  const valueClass = "min-w-0 truncate text-sm underline-offset-2 hover:underline";
  return (
    <div className="rounded-lg border px-4">
      <Divided>
        {items.map((d) => (
          <div key={`${d.label}-${d.value}`} className="flex items-center justify-between gap-6 py-3">
            <span className="shrink-0 text-xs text-muted-foreground">{d.label}</span>
            {d.href ? (
              <Link href={d.href} title={d.value} className={valueClass}>{d.value}</Link>
            ) : d.onSelect ? (
              <button type="button" title={d.value} onClick={d.onSelect} className={cn(valueClass, "rounded-sm text-right outline-none focus-visible:ring-2 focus-visible:ring-ring/50")}>{d.value}</button>
            ) : (
              <span title={d.value} className="min-w-0 truncate text-sm">{d.value}</span>
            )}
          </div>
        ))}
      </Divided>
    </div>
  );
}

/** A conversation's channel, as the round icon in front of its row. */
function ChannelIcon({ channel }: { channel: "email" | "whatsapp" }) {
  const Icon = channel === "whatsapp" ? MessageCircle : Mail;
  return (
    <div className="flex size-10 items-center justify-center rounded-full bg-muted" title={channel === "whatsapp" ? "WhatsApp" : "Email"}>
      <Icon className="size-4" />
    </div>
  );
}

/** Conversations on a contact's or a company's page: one row style, with the channel as its icon. */
export function ConversationRows({ items }: { items: Pick<ContactConversation, "id" | "channel" | "provider" | "title" | "preview" | "lastAt">[] }) {
  return (
    <div className="-mx-3 flex flex-col gap-2">
      <Divided className="pr-3 pl-16">
        {items.map((t) => (
          <ListRow key={t.id} href={`/inbox/${t.id}`} avatar={<ChannelIcon channel={t.channel} />} title={t.title} badge={<ProviderLogo provider={t.provider} />} at={t.lastAt} detail={t.preview ?? ""} />
        ))}
      </Divided>
    </div>
  );
}

/** What a contact or company page shows while it loads: the header and a few rows, in the same places. */
export function DetailSkeleton({ backHref }: { backHref: string }) {
  return (
    <DetailPage
      backHref={backHref}
      header={
        <div className="flex min-w-0 flex-1 items-center gap-3" aria-label="Loading">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <Skeleton className="h-5 w-40" />
        </div>
      }
    >
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </DetailPage>
  );
}

/** A page that could not load, as opposed to one that does not exist. */
export function LoadFailed({ icon, title, backHref, backLabel, onRetry }: { icon: typeof Users; title: string; backHref: string; backLabel: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description="Check your connection, then try again."
      action={
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild><Link href={backHref}>{backLabel}</Link></Button>
          <Button onClick={onRetry}>Retry</Button>
        </div>
      }
    />
  );
}

/** The right-hand page: a header that sticks to the scroll area, with Back on phones, and content under it. */
export function DetailPage({ backHref, header, children, className = "space-y-8" }: { backHref: string; header: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    // Solid, with a line under it, like the Summary and Conversations headers; the scrollbar starts below it.
    <ScrollArea className="h-full" scrollbarClassName="data-vertical:top-[65px]! data-vertical:h-auto!">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background p-3 md:px-4">
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
export function MultiInput({ id, label, addLabel, values, errors, onChange, disabled, type }: {
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

/** What New Contact and Edit Contact share: the same fields, held and checked the same way. */
export function useContactFields(initial: { name?: string; company?: string; role?: string; relationship?: string }, onChange?: () => void) {
  const { accounts } = useApp();
  const country = useMemo(() => defaultCountryCode(accounts), [accounts]);
  const [values, setValues] = useState({
    name: initial.name ?? "",
    company: initial.company ?? "",
    role: initial.role ?? "",
    relationship: initial.relationship ?? "",
  });
  const [emails, setEmailsState] = useState([""]);
  const [phones, setPhonesState] = useState([""]);
  const checks = checkContactFields({ name: values.name, emails, phones }, country);
  return {
    values,
    set: (key: keyof typeof values) => (value: string) => {
      setValues((v) => ({ ...v, [key]: value }));
      onChange?.();
    },
    emails,
    setEmails: (v: string[]) => {
      setEmailsState(v);
      onChange?.();
    },
    phones,
    setPhones: (v: string[]) => {
      setPhonesState(v);
      onChange?.();
    },
    ...checks,
  };
}

/** Name, addresses, numbers, company, role and relationship, in that order, for both forms. */
export function ContactFields({ idPrefix, fields, tried, disabled, editing = false, existing }: {
  idPrefix: string;
  fields: ReturnType<typeof useContactFields>;
  tried: boolean;
  disabled: boolean;
  /** Edit adds to the addresses and numbers already on file, which `existing` lists. */
  editing?: boolean;
  existing?: React.ReactNode;
}) {
  const { values, set } = fields;
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input id={`${idPrefix}-name`} value={values.name} onChange={(e) => set("name")(e.target.value)} maxLength={120} disabled={disabled} aria-invalid={tried && !!fields.nameError} autoFocus />
        {tried && fields.nameError && <p className="text-xs text-destructive">{fields.nameError}</p>}
      </div>
      {existing}
      <MultiInput
        id={`${idPrefix}-email`}
        label={editing ? "Add Email Addresses" : "Email Addresses"}
        addLabel={editing ? "Add Another" : "Add Email Address"}
        type="email"
        values={fields.emails}
        errors={tried ? fields.emailErrors : []}
        onChange={fields.setEmails}
        disabled={disabled}
      />
      <MultiInput
        id={`${idPrefix}-phone`}
        label={editing ? "Add Phone Numbers" : "Phone Numbers"}
        addLabel={editing ? "Add Another" : "Add Phone Number"}
        type="tel"
        values={fields.phones}
        errors={tried ? fields.phoneErrors : []}
        onChange={fields.setPhones}
        disabled={disabled}
      />
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-company`}>Company</Label>
        <Input id={`${idPrefix}-company`} value={values.company} onChange={(e) => set("company")(e.target.value)} maxLength={120} disabled={disabled} placeholder="Optional" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-role`}>Role</Label>
        <Input id={`${idPrefix}-role`} value={values.role} onChange={(e) => set("role")(e.target.value)} maxLength={120} disabled={disabled} placeholder="Optional" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-relationship`}>Relationship</Label>
        <Input id={`${idPrefix}-relationship`} value={values.relationship} onChange={(e) => set("relationship")(e.target.value)} maxLength={60} disabled={disabled} placeholder="Client, colleague, family" />
      </div>
    </>
  );
}

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
    const result = await createContact({
      name: fields.values.name.trim(),
      emails: fields.emails.map((e) => e.trim().toLowerCase()).filter(Boolean),
      phones: fields.phoneValues.filter((p): p is string => !!p),
      company: fields.values.company.trim(),
      role: fields.values.role.trim(),
      relationship: fields.values.relationship.trim(),
    });
    setSaving(false);
    if (!result.ok) {
      setFailure({ text: result.error, existingId: result.existingId });
      return;
    }
    markSubmitted("new_contact");
    open(result.id);
    // The list and the rest of the app pick the new person up in the background.
    void refreshContacts([]);
  };

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <ContactFields idPrefix="new-contact" fields={fields} tried={tried} disabled={saving} />
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
      <DialogContent track="new_contact" className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" showCloseButton={false}>
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
  return work || firstReach(c);
}

function bySort(sort: Sort) {
  return sort === "name" ? (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name) : byRecent;
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

// Rows drawn at first, and added each time the end of the list scrolls into view.
const PAGE_ROWS = 100;

/** Loading rows, a reason it is empty, or the rows with separators between them, drawn a page at a time. */
function ListBody({ items, label, icon, failed, empty, onRetry, children }: {
  items: unknown[] | null | undefined;
  label: string;
  icon: typeof Users;
  failed: string;
  empty: { title: string; description: string };
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const rows = Children.toArray(children);
  const [shown, setShown] = useState(PAGE_ROWS);
  const end = useRef<HTMLDivElement>(null);
  // The open row is always drawn, however far down it is.
  const open = rows.findIndex((r) => isValidElement<{ selected?: boolean }>(r) && r.props.selected);
  const count = Math.min(rows.length, Math.max(shown, open + 1));
  const more = count < rows.length;

  useEffect(() => {
    const node = end.current;
    if (!more || !node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown(count + PAGE_ROWS);
    }, { rootMargin: "600px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, count]);

  if (items === undefined) return <LoadingRows label={label} />;
  if (rows.length === 0) {
    return (
      <div className="py-24">
        {items === null ? (
          <EmptyState icon={icon} title={failed} description="Check your connection, then try again." action={<Button variant="outline" onClick={onRetry}>Retry</Button>} />
        ) : (
          <EmptyState icon={icon} title={empty.title} description={empty.description} />
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Divided className="pl-16">{rows.slice(0, count)}</Divided>
      {more && <div ref={end} className="h-px" aria-hidden />}
    </div>
  );
}

/** Lower-cased text to search, with each number also written the way it is displayed. */
function haystack(parts: (string | null | undefined)[], phones: string[] = []) {
  return [...parts, ...phones, ...phones.map(formatPhone)].filter(Boolean).join("\n").toLowerCase();
}

/** Whether the typed text is part of the name, an address, a number or the company. Digits match numbers however they are spaced. */
function matchesQuery(q: string, hay: string, phoneDigits: string) {
  if (!q) return true;
  if (hay.includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  return digits.length >= 3 && /^[\d\s+().-]+$/.test(q) && phoneDigits.includes(digits);
}

/** Sort choices as a small menu, so the header keeps its room on narrow lists. */
function SortMenu({ sort, onChange }: { sort: Sort; onChange: (sort: Sort) => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label="Sort">
          <ArrowUpDown />
          {sort === "name" ? "Name" : "Recent"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max">
        <DropdownMenuRadioGroup value={sort} onValueChange={(v) => onChange(v as Sort)}>
          <DropdownMenuRadioItem value="recent">Recent</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "/" jumps to the search box, unless you are already typing somewhere. */
function useSlashFocus(input: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector("[role=dialog], [role=alertdialog], [role=menu]")) return;
      const el = input.current;
      if (!el || el.offsetParent === null) return;
      e.preventDefault();
      el.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [input]);
}

export function ContactList({ contacts, companies }: { contacts: ContactSummary[] | null | undefined; companies: CompanySummary[] | null | undefined }) {
  const { sort, view, query } = useSort();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();
  const { suggestions, reload } = useContactsData();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const q = useDeferredValue(search).trim().toLowerCase();
  // Brands and role senders (noreply@, info@) are listed under Companies, not People.
  const people = useMemo(
    () => (contacts ?? []).filter((c) => !isCompanySender(c)).map((c) => ({
      c,
      hay: haystack([c.name, c.company, c.organizationName, c.role, ...c.emails], c.phones),
      digits: c.phones.map((p) => p.replace(/\D/g, "")).join(" "),
    })),
    [contacts],
  );
  const shownPeople = useMemo(
    () => people.filter((p) => matchesQuery(q, p.hay, p.digits)).map((p) => p.c).sort(bySort(sort)),
    [people, q, sort],
  );
  const shownCompanies = useMemo(
    () => (companies ?? []).filter((c) => !q || haystack([c.name, c.domain]).includes(q)).sort(bySort(sort)),
    [companies, q, sort],
  );
  // A tab or sort change replaces the entry rather than adding one, so Back leaves Contacts in one step.
  const go = (nextSort: Sort, nextView: View) => router.replace(withQuery("/contacts", queryOf(nextSort, nextView)));
  const noMatches = { title: "No Matches", description: `Nothing matches "${search.trim()}".` };

  return (
    // The scrollbar starts below the 145px header (with its line) instead of running behind it.
    <ScrollArea className="h-full" scrollbarClassName="data-vertical:top-[145px]! data-vertical:h-auto!">
      {/* Solid, with a line under it, like the Summary and Conversations headers. */}
      <div className="sticky top-0 z-10 space-y-2 border-b bg-background p-3">
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
          <SortMenu sort={sort} onChange={(next) => go(next, view)} />
        </div>
        <Input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearch("");
              e.currentTarget.blur();
            }
          }}
          placeholder="Search Contacts"
          aria-label="Search Contacts"
          maxLength={120}
          autoComplete="off"
        />
      </div>
      <NewContactDialog open={adding} onOpenChange={setAdding} />
      <div className="px-3 pb-3">
        {view === "companies" ? (
          <ListBody
            key={`companies|${sort}|${q}`}
            items={companies}
            label="Loading companies"
            icon={Building2}
            failed="Companies Did Not Load"
            empty={q ? noMatches : { title: "No Companies Yet", description: "People who write from a work address are grouped here by company." }}
            onRetry={reload}
          >
            {shownCompanies.map((c) => (
              <ListRow
                key={c.id}
                href={withQuery(`/contacts/companies/${c.id}`, query)}
                avatar={<ContactAvatar contact={{ avatarPath: c.avatarPath }} className="size-10" />}
                title={c.name}
                at={c.lastAt}
                detail={[c.domain, plural(c.addresses, "address", "addresses"), plural(c.conversations, "conversation")].join(" · ")}
                selected={params.id === c.id}
                className="scroll-mt-[144px]"
              />
            ))}
          </ListBody>
        ) : (
          <>
            {/* Shown above People while there are likely duplicates to review. */}
            {!q && !!suggestions?.length && (
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
              key={`people|${sort}|${q}`}
              items={contacts}
              label="Loading contacts"
              icon={Users}
              failed="Contacts Did Not Load"
              empty={q ? noMatches : { title: "No Contacts Yet", description: "People appear here as your accounts sync." }}
              onRetry={reload}
            >
              {shownPeople.map((c) => (
                <ListRow
                  key={c.id}
                  href={withQuery(`/contacts/${c.id}`, query)}
                  avatar={<ContactAvatar contact={c} className="size-10" />}
                  title={c.name}
                  at={c.lastAt}
                  detail={detailOf(c)}
                  selected={params.id === c.id}
                  className="scroll-mt-[144px]"
                />
              ))}
            </ListBody>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
