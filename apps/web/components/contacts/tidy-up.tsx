"use client";

// The Tidy Up page (/contacts/tidy): possible duplicates, which open Suggested Merges, and people who only have a number
// or an address for a name, each opening their page where Edit adds the name.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { useContactsData } from "@/components/contacts-data";
import { niceName } from "@/lib/format";
import { plural } from "@/lib/contact-list-helpers";
import { unnamedContacts } from "@/lib/tidy-up";
import { withQuery } from "@/lib/utils";
import { DetailPage } from "./detail-page";
import { Divided, ListRow, Section } from "./list-rows";

// Names listed at first; Show More adds the same again.
const PAGE = 25;

export function TidyUp() {
  const query = useSearchParams().toString();
  const { contacts, suggestions, suggestionsMore } = useContactsData();
  const [shown, setShown] = useState(PAGE);
  const unnamed = useMemo(() => unnamedContacts(contacts ?? []), [contacts]);
  const pairs = (suggestions?.length ?? 0) + suggestionsMore;
  const backHref = withQuery("/contacts", query);

  return (
    <DetailPage backHref={backHref} header={<h1 className="min-w-0 flex-1 truncate text-sm font-medium">Tidy Up</h1>}>
      {pairs === 0 && unnamed.length === 0 ? (
        <EmptyState icon={Sparkles} title="All Tidy" description="No duplicates to review and every contact has a name." />
      ) : (
        <>
          {pairs > 0 && (
            <Section title="Possible Duplicates">
              <p className="text-sm text-muted-foreground">{plural(pairs, "pair")}{suggestionsMore > 0 && " or more"} that may be the same person. You choose which to merge.</p>
              <Button variant="secondary" asChild><Link href={withQuery("/contacts/merges", query)}>Review Suggested Merges</Link></Button>
            </Section>
          )}
          {unnamed.length > 0 && (
            <Section title="Needs a Name">
              <p className="text-sm text-muted-foreground">{plural(unnamed.length, "contact")} shown by number or address. Open one and choose Edit to add a name.</p>
              <div className="-mx-3 flex flex-col gap-2">
                <Divided className="pr-3 pl-14">
                  {unnamed.slice(0, shown).map((c) => (
                    <ListRow key={c.id} href={withQuery(`/contacts/${c.id}`, query)} avatar={<ContactAvatar contact={c} className="size-8" />} title={niceName(c.name)} at={c.lastAt} detail={c.company ?? c.role ?? ""} />
                  ))}
                </Divided>
                {unnamed.length > shown && (
                  <div className="px-3"><Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>Show More ({unnamed.length - shown})</Button></div>
                )}
              </div>
            </Section>
          )}
        </>
      )}
    </DetailPage>
  );
}
