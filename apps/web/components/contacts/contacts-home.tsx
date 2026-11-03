"use client";

// What the Contacts page shows with no one open, like the empty Conversations page: a greeting, the numbers (people,
// starred, going quiet), who is going quiet, who you were last in touch with, what needs tidying and the team's clients.
// Hidden on a phone, where the list is the page.

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { UserPen, Users } from "lucide-react";
import { useApp } from "@/lib/store";
import { useMyTeam } from "@/lib/share";
import { useSignInName } from "@/lib/onboarding";
import { greeting } from "@/lib/sent-days";
import { byRecent, plural, queryOf, sortAndView } from "@/lib/contact-list-helpers";
import type { ContactSummary } from "@/lib/contacts";
import { goingQuiet, lastContactAt } from "@/lib/going-quiet";
import { isCompanySender } from "@/lib/people";
import { tidyCounts } from "@/lib/tidy-up";
import { niceName, relTime } from "@/lib/format";
import { withQuery } from "@/lib/utils";
import { ContactAvatar } from "@/components/primitives";
import { Card, IconCircle, PaneColumn, Row, Separated, StatCard } from "@/components/surface";
import { useContactsData } from "@/components/contacts-data";
import { TeamClientsCard } from "@/components/team-clients";
import { factOf, mainProviders } from "./list-controls";
import { BadgedAvatar } from "./list-rows";

/** Rows per card: a glance, with See All for the rest. */
const SHOWN = 3;

export function ContactsHome() {
  const { profile, listThreads } = useApp();
  const signInName = useSignInName();
  const team = useMyTeam();
  const { sort, query, rel, quiet } = sortAndView(useSearchParams());
  const { contacts, suggestions, suggestionsMore } = useContactsData();
  const inboxThreads = listThreads("all", "none");
  const providers = useMemo(() => mainProviders(inboxThreads), [inboxThreads]);
  const people = useMemo(() => (contacts ?? []).filter((c) => !c.hidden && !isCompanySender(c)), [contacts]);
  const quietList = useMemo(() => goingQuiet(contacts ?? [], quiet), [contacts, quiet]);
  const recent = useMemo(() => people.filter((c) => c.lastAt).sort(byRecent).slice(0, SHOWN), [people]);
  const tidy = useMemo(() => tidyCounts(contacts ?? [], (suggestions?.length ?? 0) + suggestionsMore, suggestionsMore > 0), [contacts, suggestions, suggestionsMore]);
  const loading = contacts === undefined;
  const tidyHref = withQuery("/contacts/tidy", query);

  const personRow = (c: ContactSummary, at: string | null, detail: string) => (
    <Row
      key={c.id}
      href={withQuery(`/contacts/${c.id}`, query)}
      lead={<BadgedAvatar avatar={<ContactAvatar contact={c} className="size-10" />} provider={providers.get(c.id)} />}
      title={niceName(c.name)}
      meta={at ? relTime(at) : undefined}
      detail={detail || undefined}
    />
  );

  return (
    <PaneColumn center>
      <h1 className="pb-3 text-2xl font-medium">{greeting(new Date(), profile.name || signInName)}</h1>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="People" value={loading ? undefined : people.length} />
        <StatCard label="Starred" value={loading ? undefined : people.filter((c) => c.vip).length} />
        <StatCard label="Going Quiet" value={loading ? undefined : quietList.length} />
      </div>
      {quietList.length > 0 && (
        <Card title="Going Quiet" href={withQuery("/contacts", queryOf(sort, "quiet", { rel, quiet }))}>
          <Separated>{quietList.slice(0, SHOWN).map((c) => personRow(c, lastContactAt(c), factOf(c)))}</Separated>
        </Card>
      )}
      {recent.length > 0 && (
        <Card title="Recently in Touch" href={withQuery("/contacts", queryOf("recent", "people", { rel, quiet }))}>
          <Separated>{recent.map((c) => personRow(c, c.lastAt, factOf(c)))}</Separated>
        </Card>
      )}
      {tidy.total > 0 && (
        <Card title="Tidy Up" href={tidyHref}>
          <Separated>
            {tidy.pairs > 0 && <Row key="pairs" href={tidyHref} lead={<IconCircle icon={Users} />} title="Possible Duplicates" meta={`${tidy.pairs}${tidy.more ? "+" : ""}`} detail={plural(tidy.pairs, "pair")} />}
            {tidy.unnamed > 0 && <Row key="unnamed" href={tidyHref} lead={<IconCircle icon={UserPen} />} title="Needs a Name" meta={String(tidy.unnamed)} detail={plural(tidy.unnamed, "contact")} />}
          </Separated>
        </Card>
      )}
      {team && <TeamClientsCard />}
    </PaneColumn>
  );
}
