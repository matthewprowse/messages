"use client";

// The Contacts list. The pieces the Contacts pages share (rows, detail page frame, form fields) live in
// components/contacts/ and are re-exported here, so contact-view.tsx, company-view.tsx and merge-suggestions.tsx
// keep importing from this file. Search and ordering rules are in lib/contact-list-helpers.ts.

import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, Combine, Users } from "lucide-react";
import type { ContactSummary } from "@/lib/contacts";
import type { CompanySummary } from "@/lib/organizations";
import { isCompanySender } from "@/lib/people";
import { searchDigits } from "@/lib/phone-search";
import { bySort, detailOf, haystack, matchesQuery, plural, queryOf, sortAndView, type Sort, type View } from "@/lib/contact-list-helpers";
import { niceName } from "@/lib/format";
import { cn, withQuery } from "@/lib/utils";
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
import { SortMenu, useSlashFocus } from "./contacts/list-controls";
import { NewContactDialog } from "./contacts/new-contact-dialog";

export { byRecent, firstReach, plural } from "@/lib/contact-list-helpers";
export { ConversationRows, DetailList, Divided, ListRow, Section } from "./contacts/list-rows";
export { DetailPage, DetailSkeleton, LoadFailed } from "./contacts/detail-page";
export { ContactFields, MultiInput, useContactFields } from "./contacts/contact-fields";

function useSort(): { sort: Sort; view: View; query: string } {
  return sortAndView(useSearchParams());
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
    () => (contacts ?? []).filter((c) => !isCompanySender(c) && c.hidden === (view === "hidden")).map((c) => ({
      c,
      hay: haystack([c.name, c.company, c.organizationName, c.role, ...c.emails], c.phones),
      digits: c.phones.map(searchDigits).join(" "),
    })),
    [contacts, view],
  );
  const hiddenCount = useMemo(() => (contacts ?? []).filter((c) => c.hidden).length, [contacts]);
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
    // The scrollbar starts below the 158px header (with its line) instead of running behind it.
    <ScrollArea className="h-full" scrollbarClassName="data-vertical:top-[158px]! data-vertical:h-auto!">
      {/* Solid, with a line under it, like the Summary and Conversations headers. */}
      <div className="sticky top-0 z-10 bg-background">
        <PaneHeader title="Contacts" action={<Button variant="secondary" onClick={() => setAdding(true)}>New Contact</Button>}>
          <PaneControls>
            <ViewButtons
              label="Show"
              value={view}
              onSelect={(v) => go(sort, v)}
              items={[
                { key: "people", label: "People" },
                { key: "companies", label: "Companies" },
                ...((hiddenCount > 0 || view === "hidden") ? [{ key: "hidden" as const, label: "Hidden" }] : []),
              ]}
            />
            <SortMenu sort={sort} onChange={(next) => go(next, view)} />
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
            {!q && <TeamClientsRow selected={pathname === "/contacts/team"} query={query} />}
            {/* Shown above People while there are likely duplicates to review. */}
            {!q && !!suggestions?.length && (
              <>
                <ListRow
                  href={withQuery("/contacts/merges", query)}
                  avatar={
                    <div className={cn("flex size-8 items-center justify-center rounded-full", pathname === "/contacts/merges" ? "bg-background" : "bg-muted")}>
                      <Combine className="size-4" />
                    </div>
                  }
                  title="Suggested Merges"
                  aside={<Badge variant="secondary">{suggestions.length}</Badge>}
                  detail={`${plural(suggestions.length, "pair")} that may be the same person`}
                  selected={pathname === "/contacts/merges"}
                />
                <div className="my-2 pl-14"><Separator /></div>
              </>
            )}
            <ListBody
              key={`people|${sort}|${q}`}
              items={contacts}
              label="Loading contacts"
              icon={Users}
              failed="Contacts Did Not Load"
              empty={q ? noMatches : view === "hidden" ? { title: "No Hidden Contacts", description: "Contacts you hide appear here." } : { title: "No Contacts Yet", description: "People appear here as your accounts sync." }}
              onRetry={reload}
            >
              {shownPeople.map((c) => (
                <ListRow
                  key={c.id}
                  href={withQuery(`/contacts/${c.id}`, query)}
                  avatar={<ContactAvatar contact={c} className="size-8" />}
                  title={niceName(c.name)}
                  at={c.lastAt}
                  detail={detailOf(c)}
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
