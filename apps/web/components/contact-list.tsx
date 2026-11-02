"use client";

// The Contacts list. The pieces the Contacts pages share (rows, detail page frame, form fields) live in
// components/contacts/ and are re-exported here, so contact-view.tsx, company-view.tsx and merge-suggestions.tsx
// keep importing from this file. Search and ordering rules are in lib/contact-list-helpers.ts. People shows starred
// contacts first and where you stand with each; Going Quiet lists starred people and clients you have not been in touch with.

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, Sparkles, Star, Users } from "lucide-react";
import type { ContactSummary } from "@/lib/contacts";
import type { CompanySummary } from "@/lib/organizations";
import { isCompanySender } from "@/lib/people";
import { searchDigits } from "@/lib/phone-search";
import { bySort, byVipThen, detailOf, fold, haystack, matchesQuery, plural, queryOf, sortAndView, type Filters, type Sort, type View } from "@/lib/contact-list-helpers";
import { goingQuiet } from "@/lib/going-quiet";
import { matchesRelationship } from "@/lib/relationships";
import { tidyCounts } from "@/lib/tidy-up";
import { isPlaceholderName } from "@/lib/merging";
import { niceName } from "@/lib/format";
import { withQuery } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Kbd } from "@/components/ui/kbd";
import { PaneControls, PaneHeader, SearchBand, ViewButtons } from "@/components/pane";
import { Separator } from "@/components/ui/separator";
import { CompanyAvatar, ContactAvatar } from "@/components/primitives";
import { Badge } from "@/components/ui/badge";
import { useContactsData } from "@/components/contacts-data";
import { TeamClientsRow } from "@/components/team-clients";
import { ListRow } from "./contacts/list-rows";
import { ListBody } from "./contacts/list-body";
import { QuietDaysMenu, RelationshipFilter, SortMenu, useSlashFocus } from "./contacts/list-controls";
import { NewContactDialog } from "./contacts/new-contact-dialog";
import { TransferMenu } from "./contacts/transfer-menu";

export { byRecent, firstReach, plural } from "@/lib/contact-list-helpers";
export { ConversationRows, DetailList, Divided, ListRow, Section } from "./contacts/list-rows";
export { DetailPage, DetailSkeleton, LoadFailed } from "./contacts/detail-page";
export { ContactFields, MultiInput, useContactFields } from "./contacts/contact-fields";

function useSort(): { sort: Sort; view: View; query: string } & Filters {
  return sortAndView(useSearchParams());
}

export function ContactList({ contacts, companies }: { contacts: ContactSummary[] | null | undefined; companies: CompanySummary[] | null | undefined }) {
  const { sort, view, query, rel, quiet } = useSort();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();
  const { suggestions, suggestionsMore, needCompanies, reload } = useContactsData();
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
    () => (contacts ?? []).filter((c) => (view === "hidden" ? c.hidden : !c.hidden && !isCompanySender(c)) && matchesRelationship(c, rel)).map((c) => ({
      c,
      hay: haystack([c.name, c.company, c.organizationName, c.role, ...c.emails, ...c.handles], c.phones),
      digits: c.phones.map(searchDigits).join(" "),
    })),
    [contacts, view, rel],
  );
  const hiddenCount = useMemo(() => (contacts ?? []).filter((c) => c.hidden).length, [contacts]);
  const shownPeople = useMemo(
    () => people.filter((p) => matchesQuery(q, p.hay, p.digits)).map((p) => p.c).sort(view === "hidden" ? bySort(sort) : byVipThen(sort)),
    [people, q, sort, view],
  );
  // Starred people and clients with no contact for `quiet` days, longest silence first; it is not re-sorted.
  const quietList = useMemo(
    () => goingQuiet(contacts ?? [], quiet).filter((c) => matchesRelationship(c, rel)),
    [contacts, quiet, rel],
  );
  const shownQuiet = useMemo(
    () => quietList.filter((c) => matchesQuery(q, haystack([c.name, c.company, c.organizationName, c.role, ...c.emails, ...c.handles], c.phones), c.phones.map(searchDigits).join(" "))),
    [quietList, q],
  );
  const allQuietCount = useMemo(() => goingQuiet(contacts ?? [], quiet).length, [contacts, quiet]);
  const tidy = useMemo(() => tidyCounts(contacts ?? [], (suggestions?.length ?? 0) + suggestionsMore, suggestionsMore > 0), [contacts, suggestions, suggestionsMore]);
  const shownCompanies = useMemo(
    () => (companies ?? []).filter((c) => !q || haystack([c.name, c.domain]).includes(q)).sort(bySort(sort)),
    [companies, q, sort],
  );
  // When nothing in People matches, say what the other tabs hold for the same search.
  const elsewhere = useMemo(() => {
    if (!q || view !== "people" || shownPeople.length > 0) return null;
    const hidden = (contacts ?? []).filter((c) => c.hidden && matchesQuery(q, haystack([c.name, c.company, c.organizationName, c.role, ...c.emails, ...c.handles], c.phones), c.phones.map(searchDigits).join(" "))).length;
    return { companies: shownCompanies.length, hidden };
  }, [q, view, shownPeople.length, contacts, shownCompanies.length]);
  // Every contact is a company sender or hidden, so People is empty for a reason other than a new account.
  const allElsewhere = !!contacts?.length && view === "people" && !people.length;
  // A tab or sort change replaces the entry rather than adding one, so Back leaves Contacts in one step.
  const go = (nextSort: Sort, nextView: View, filters: Filters = { rel, quiet }) => router.replace(withQuery("/contacts", queryOf(nextSort, nextView, filters)));
  const relationships = (contacts ?? []).filter((c) => c.relationship?.trim());
  const noMatches = { title: "No Matches", description: `Nothing matches "${search.trim()}".` };
  const peopleEmpty = q
    ? {
        ...noMatches,
        // Buttons to the tabs that do have a match.
        action: elsewhere && (elsewhere.companies > 0 || elsewhere.hidden > 0) && (
          <div className="flex flex-wrap justify-center gap-2">
            {elsewhere.companies > 0 && <Button variant="secondary" onClick={() => go(sort, "companies")}>{plural(elsewhere.companies, "Result")} in Companies</Button>}
            {elsewhere.hidden > 0 && <Button variant="secondary" onClick={() => go(sort, "hidden")}>{plural(elsewhere.hidden, "Result")} in Hidden</Button>}
          </div>
        ),
      }
    : view === "hidden"
      ? { title: "No Hidden Contacts", description: "Contacts you hide appear here." }
      : allElsewhere
        ? { title: "Everyone Is Under Companies or Hidden", description: "Nobody is listed under People right now.", action: <Button variant="secondary" onClick={() => go(sort, "companies")}>Open Companies</Button> }
        : { title: "No Contacts Yet", description: "People appear here as your accounts sync." };

  return (
    // The scrollbar starts below the 158px header (with its line) instead of running behind it.
    <ScrollArea className="h-full" scrollbarClassName="data-vertical:top-[158px]! data-vertical:h-auto!">
      {/* Solid, with a line under it, like the Summary and Conversations headers. */}
      <div className="sticky top-0 z-10 bg-background">
        <PaneHeader title="Contacts" action={<div className="flex items-center gap-2"><TransferMenu /><Button variant="secondary" onClick={() => setAdding(true)}>New Contact</Button></div>}>
          <PaneControls>
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
            {view === "quiet" ? <QuietDaysMenu days={quiet} onChange={(days) => go(sort, view, { rel, quiet: days })} /> : <SortMenu sort={sort} onChange={(next) => go(next, view)} />}
          </PaneControls>
        </PaneHeader>
        <SearchBand
          inputRef={searchRef}
          value={search}
          onChange={setSearch}
          placeholder="Search Contacts"
          keyShortcut="/"
          hint={<>Search Contacts <Kbd>/</Kbd></>}
          maxLength={120}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearch("");
              e.currentTarget.blur();
            }
          }}
        />
      </div>
      <NewContactDialog open={adding} onOpenChange={setAdding} />
      <div className="p-3">
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
                avatar={<CompanyAvatar logoPath={c.logoPath} className="size-8" />}
                title={niceName(c.name)}
                at={c.lastAt}
                detail={[c.domain, plural(c.addresses, "address", "addresses"), plural(c.conversations, "conversation")].join(" · ")}
                selected={params.id === c.id}
                className="scroll-mt-[157px]"
              />
            ))}
          </ListBody>
        ) : (
          <>
            {!q && view !== "quiet" && <TeamClientsRow selected={pathname === "/contacts/team"} query={query} />}
            {/* Duplicates to review and contacts with no name, in one place. */}
            {!q && view !== "quiet" && tidy.total > 0 && (
              <>
                <ListRow
                  href={withQuery("/contacts/tidy", query)}
                  avatar={
                    <div className={pathname === "/contacts/tidy" ? "flex size-8 items-center justify-center rounded-full bg-background" : "flex size-8 items-center justify-center rounded-full bg-muted"}>
                      <Sparkles className="size-4" />
                    </div>
                  }
                  title="Tidy Up"
                  aside={<Badge variant="secondary">{tidy.total}{tidy.more && "+"}</Badge>}
                  detail={tidy.detail}
                  selected={pathname === "/contacts/tidy" || pathname === "/contacts/merges"}
                />
                <div className="my-2 pl-14"><Separator /></div>
              </>
            )}
            {(relationships.length > 0 || rel !== "all") && (
              <div className="mb-2"><RelationshipFilter contacts={relationships} value={rel} onChange={(next) => go(sort, view, { rel: next, quiet })} /></div>
            )}
            <ListBody
              key={`${view}|${sort}|${q}|${rel}|${quiet}`}
              items={contacts}
              label="Loading contacts"
              icon={view === "quiet" ? Sparkles : Users}
              failed="Contacts Did Not Load"
              empty={view === "quiet" && !q ? { title: "No One Is Going Quiet", description: `Starred people and clients you have been in touch with in the last ${quiet} days show nothing here.` } : peopleEmpty}
              onRetry={reload}
            >
              {(view === "quiet" ? shownQuiet : shownPeople).map((c) => (
                <ListRow
                  key={c.id}
                  href={withQuery(`/contacts/${c.id}`, query)}
                  avatar={<ContactAvatar contact={c} className="size-8" />}
                  title={niceName(c.name)}
                  badge={c.vip ? <Star aria-label="Starred" className="size-3.5 shrink-0 fill-current text-muted-foreground" /> : undefined}
                  at={c.lastAt}
                  detail={detailOf(c)}
                  aside={isPlaceholderName(c.name) ? <Badge variant="outline">Needs a Name</Badge> : undefined}
                  selected={params.id === c.id}
                  className="scroll-mt-[157px]"
                />
              ))}
            </ListBody>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
