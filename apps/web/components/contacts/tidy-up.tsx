"use client";

// The Tidy Up page (/contacts/tidy): possible duplicates, which open Suggested Merges, and people who only have a number
// or an address for a name, each opening their page where Edit adds the name.

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { Card, IconCircle, Row, Separated } from "@/components/surface";
import { useContactsData } from "@/components/contacts-data";
import { niceName, relTime } from "@/lib/format";
import { plural } from "@/lib/contact-list-helpers";
import { unnamedContacts } from "@/lib/tidy-up";
import { withQuery } from "@/lib/utils";
import { DetailHeading, DetailPage } from "./detail-page";

// Names listed at first; Show More adds the same again.
const PAGE = 25;

export function TidyUp() {
  const query = useSearchParams().toString();
  const { contacts, suggestions, suggestionsMore } = useContactsData();
  const [shown, setShown] = useState(PAGE);
  const unnamed = useMemo(() => unnamedContacts(contacts ?? []), [contacts]);
  const pairs = (suggestions?.length ?? 0) + suggestionsMore;
  const mergesHref = withQuery("/contacts/merges", query);

  return (
    <DetailPage backHref={withQuery("/contacts", query)} header={<DetailHeading avatar={<IconCircle icon={Sparkles} />} title="Tidy Up" />}>
      {pairs === 0 && unnamed.length === 0 ? (
        <EmptyState icon={Sparkles} title="All Tidy" />
      ) : (
        <>
          {pairs > 0 && (
            <Card title="Possible Duplicates" href={mergesHref} hrefLabel="Review">
              <Row href={mergesHref} lead={<IconCircle icon={Users} />} title={`${plural(pairs, "Pair")}${suggestionsMore > 0 ? " or More" : ""}`} detail="Suggested Merges" />
            </Card>
          )}
          {unnamed.length > 0 && (
            <Card title={`Needs a Name (${unnamed.length})`}>
              <Separated>
                {unnamed.slice(0, shown).map((c) => (
                  <Row
                    key={c.id}
                    href={withQuery(`/contacts/${c.id}`, query)}
                    lead={<ContactAvatar contact={c} className="size-10" />}
                    title={niceName(c.name)}
                    meta={c.lastAt ? relTime(c.lastAt) : undefined}
                    detail={c.company ?? c.role ?? undefined}
                  />
                ))}
              </Separated>
              {unnamed.length > shown && (
                <Button variant="ghost" className="m-2 text-muted-foreground" onClick={() => setShown((n) => n + PAGE)}>Show More</Button>
              )}
            </Card>
          )}
        </>
      )}
    </DetailPage>
  );
}
