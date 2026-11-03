"use client";

// The Contacts list. The pieces the Contacts pages share (rows, detail page frame, form fields) live in
// components/contacts/ and are re-exported here, so contact-view.tsx, company-view.tsx and merge-suggestions.tsx
// keep importing from this file. Search and ordering rules are in lib/contact-list-helpers.ts. People shows starred
// contacts first with their unread count; Going Quiet lists starred people and clients you have not been in touch with.

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Building2, Plus, Sparkles, Star, Users } from "lucide-react";
import type { ContactSummary } from "@/lib/contacts";
import type { CompanySummary } from "@/lib/organizations";
import { isCompanySender } from "@/lib/people";
import { searchDigits } from "@/lib/phone-search";
import { bySort, byVipThen, fold, haystack, matchesQuery, plural, queryOf, sortAndView, unreadByPerson, type Filters, type Sort, type View } from "@/lib/contact-list-helpers";
import { goingQuiet } from "@/lib/going-quiet";
import { matchesRelationship } from "@/lib/relationships";
import { niceName } from "@/lib/format";
import { withQuery } from "@/lib/utils";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Kbd } from "@/components/ui/kbd";
import { PaneHeader, ViewButtons } from "@/components/pane";
import { IconAction } from "@/components/tip";
import { CompanyAvatar, ContactAvatar } from "@/components/primitives";
import { useContactsData } from "@/components/contacts-data";
import { ListRow } from "./contacts/list-rows";
import { ListBody } from "./contacts/list-body";
import { ContactsFilter, factOf, mainProviders, useSlashFocus } from "./contacts/list-controls";
import { NewContactDialog } from "./contacts/new-contact-dialog";
import { TransferMenu } from "./contacts/transfer-menu";

export { byRecent, firstReach, plural } from "@/lib/contact-list-helpers";
export { BadgedAvatar, ConversationRows, DetailList, Divided, ListRow } from "./contacts/list-rows";
export { DetailHeading, DetailPage, DetailSkeleton, LoadFailed } from "./contacts/detail-page";
export { ContactFields, MultiInput, useContactFields } from "./contacts/contact-fields";

const searchText = (c: ContactSummary) => haystack([c.name, c.company, c.organizationName, c.role, ...c.emails, ...c.handles], c.phones);
const searchPhones = (c: ContactSummary) => c.phones.map(searchDigits).join(" ");

export function ContactList({ contacts, companies }: { contacts: ContactSummary[] | null | undefined; companies: CompanySummary[] | null | undefined }) {
  const { sort, view, query, rel, quiet } = sortAndView(useSearchParams());
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const { needCompanies, reload } = useContactsData();
  // The same conversations the Inbox lists (not junk, archived or deleted), so a row's count matches what the Inbox shows.
  const { listThreads } = useApp();
  const inboxThreads = listThreads("all", "none");
  const unread = useMemo(() => unreadByPerson(inboxThreads), [inboxThreads]);
  const providers = useMemo(() => mainProviders(inboxThreads), [inboxThreads]);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const q = fold(useDeferredValue(search).trim());
  // Companies load when the tab is open, or when a search might find one.
  const wantsCompanies = view === "companies" || !!q;
  useEffect(() => {
    if (wantsCompanies) needCompanies();
  }, [wantsCompanies, needCompanies]);
  // Brands and role senders (noreply@, info@) are listed under Companies, not People. Hidden shows everyone hidden, so
  // a hidden sender can be shown again whichever tab it would have been on.
  const people = useMemo(
    () => (contacts ?? []).filter((c) => (view === "hidden" ? c.hidden : !c.hidden && !isCompanySender(c)) && matchesRelationship(c, rel)).map((c) => ({ c, hay: searchText(c), digits: searchPhones(c) })),
    [contacts, view, rel],
  );
  const hiddenCount = useMemo(() => (contacts ?? []).filter((c) => c.hidden).length, [contacts]);
  const shownPeople = useMemo(
    () => people.filter((p) => matchesQuery(q, p.hay, p.digits)).map((p) => p.c).sort(view === "hidden" ? bySort(sort) : byVipThen(sort)),
    [people, q, sort, view],
  );
  // Starred people and clients with no contact for `quiet` days, longest silence first; it is not re-sorted.
  const shownQuiet = useMemo(
    () => goingQuiet(contacts ?? [], quiet).filter((c) => matchesRelationship(c, rel) && matchesQuery(q, searchText(c), searchPhones(c))),
    [contacts, quiet, rel, q],
  );
  const allQuietCount = useMemo(() => goingQuiet(contacts ?? [], quiet).length, [contacts, quiet]);
  const shownCompanies = useMemo(
    () => (companies ?? []).filter((c) => !q || haystack([c.name, c.domain]).includes(q)).sort(bySort(sort)),
    [companies, q, sort],
  );
  // When nothing in People matches, say what the other tabs hold for the same search.
  const elsewhere = useMemo(() => {
    if (!q || view !== "people" || shownPeople.length > 0) return null;
    const hidden = (contacts ?? []).filter((c) => c.hidden && matchesQuery(q, searchText(c), searchPhones(c))).length;
    return { companies: shownCompanies.length, hidden };
  }, [q, view, shownPeople.length, contacts, shownCompanies.length]);
  // Every contact is a company sender or hidden, so People is empty for a reason other than a new account.
  const allElsewhere = !!contacts?.length && view === "people" && !people.length;
  // A tab or sort change replaces the entry rather than adding one, so Back leaves Contacts in one step.
  const go = (nextSort: Sort, nextView: View, filters: Filters = { rel, quiet }) => router.replace(withQuery("/contacts", queryOf(nextSort, nextView, filters)));
  const relationships = useMemo(() => (contacts ?? []).filter((c) => c.relationship?.trim()), [contacts]);
  const peopleEmpty = q
    ? {
        title: "No Matches",
        // Buttons to the tabs that do have a match.
        action: elsewhere && (elsewhere.companies > 0 || elsewhere.hidden > 0) && (
          <div className="flex flex-wrap justify-center gap-2">
            {elsewhere.companies > 0 && <Button variant="secondary" onClick={() => go(sort, "companies")}>{plural(elsewhere.companies, "Result")} in Companies</Button>}
            {elsewhere.hidden > 0 && <Button variant="secondary" onClick={() => go(sort, "hidden")}>{plural(elsewhere.hidden, "Result")} in Hidden</Button>}
          </div>
        ),
      }
    : view === "hidden"
      ? { title: "No Hidden Contacts" }
      : allElsewhere
        ? { title: "Everyone Is Under Companies or Hidden", action: <Button variant="secondary" onClick={() => go(sort, "companies")}>Open Companies</Button> }
        : { title: "No Contacts Yet" };

  return (
    // The header sits above the scroll area, so the rows and their scrollbar both start below it.
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader
        className="shrink-0"
        title="Contacts"
        action={
          <>
            <ContactsFilter
              view={view}
              sort={sort}
              rel={rel}
              quiet={quiet}
              contacts={relationships}
              onSort={(next) => go(next, view)}
              onRel={(next) => go(sort, view, { rel: next, quiet })}
              onQuiet={(days) => go(sort, view, { rel, quiet: days })}
            />
            <IconAction label="New Contact" icon={Plus} onClick={() => setAdding(true)} />
            <TransferMenu />
          </>
        }
        views={
          <ViewButtons
            label="Show"
            value={view}
            onSelect={(v) => go(sort, v)}
            items={[
              { key: "people", label: "People" },
              { key: "companies", label: "Companies" },
              ...((allQuietCount > 0 || view === "quiet") ? [{ key: "quiet" as const, label: "Going Quiet" }] : []),
              ...((hiddenCount > 0 || view === "hidden") ? [{ key: "hidden" as const, label: "Hidden" }] : []),
            ]}
          />
        }
        search={{
          inputRef: searchRef,
          hint: <>Search Contacts <Kbd>/</Kbd></>,
          maxLength: 120,
          value: search,
          onChange: setSearch,
          placeholder: "Search Contacts",
          keyShortcut: "/",
          onKeyDown: (e) => {
            if (e.key === "Escape") {
              setSearch("");
              e.currentTarget.blur();
            }
          },
        }}
      />
      <NewContactDialog open={adding} onOpenChange={setAdding} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          {view === "companies" ? (
            <ListBody
              key={`companies|${sort}|${q}`}
              items={companies}
              label="Loading companies"
              icon={Building2}
              failed="Companies Did Not Load"
              empty={{ title: q ? "No Matches" : "No Companies Yet" }}
              onRetry={reload}
            >
              {shownCompanies.map((c) => (
                <ListRow
                  key={c.id}
                  href={withQuery(`/contacts/companies/${c.id}`, query)}
                  avatar={<CompanyAvatar logoPath={c.logoPath} className="size-10" />}
                  title={niceName(c.name)}
                  at={c.lastAt}
                  detail={c.domain}
                  selected={params.id === c.id}
                />
              ))}
            </ListBody>
          ) : (
            <ListBody
              key={`${view}|${sort}|${q}|${rel}|${quiet}`}
              items={contacts}
              label="Loading contacts"
              icon={view === "quiet" ? Sparkles : Users}
              failed="Contacts Did Not Load"
              empty={view === "quiet" && !q ? { title: "No One Is Going Quiet" } : peopleEmpty}
              onRetry={reload}
            >
              {(view === "quiet" ? shownQuiet : shownPeople).map((c) => (
                <ListRow
                  key={c.id}
                  href={withQuery(`/contacts/${c.id}`, query)}
                  avatar={<ContactAvatar contact={c} className="size-10" />}
                  provider={providers.get(c.id)}
                  title={niceName(c.name)}
                  badge={c.vip ? <Star aria-label="Starred" className="size-3.5 shrink-0 fill-current text-muted-foreground" /> : undefined}
                  at={c.lastAt}
                  detail={factOf(c)}
                  unread={unread.get(c.id)}
                  selected={params.id === c.id}
                />
              ))}
            </ListBody>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
