"use client";

// Team Clients under Contacts: the clients everyone on the team looks after, with their company and the agent or agents
// who look after them, and a card of the first few on the empty Contacts pane, so the person's own contacts are
// untouched. It holds names only: a chat is read by its agent and whoever it is assigned to, and an assigned chat is in
// the assignee's Conversations (step 5), never here.

import { Suspense, useDeferredValue, useState } from "react";
import { Briefcase } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { agentsText, useTeamClients, type TeamClient } from "@/lib/team-clients";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { SearchBand } from "@/components/pane";
import { Card, IconCircle, Row, Separated } from "@/components/surface";
import { DetailHeading, DetailPage, LoadFailed, plural } from "@/components/contact-list";
import { ClientMenu, TeamCompanies } from "@/components/team-client-manage";

const HREF = "/contacts/team";
/** Clients on the empty pane's card: a glance, with See All for the rest. */
const SHOWN = 3;

/** One client as a row: who looks after them, and on the full page their company first. */
function ClientRow({ client, me, full = false, end }: { client: TeamClient; me: string | undefined; full?: boolean; end?: React.ReactNode }) {
  const agents = `Looked after by ${agentsText(client.agents, me)}`;
  return (
    <Row
      lead={<ContactAvatar contact={{ isCompany: false }} className="size-10" />}
      title={client.name}
      detail={full && client.company ? `${client.company}, ${agents}` : agents}
      end={end}
    />
  );
}

/** The empty Contacts pane's Team Clients card, for someone in a team. Nothing until there is a client. */
export function TeamClientsCard() {
  const { session } = useAuth();
  const { clients } = useTeamClients();
  if (!clients?.length) return null;
  return (
    <Card title="Team Clients" href={HREF}>
      <Separated>
        {clients.slice(0, SHOWN).map((c) => <ClientRow key={c.id} client={c} me={session?.user.id} />)}
      </Separated>
    </Card>
  );
}

function Clients() {
  const { session } = useAuth();
  const { clients, reload } = useTeamClients();
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search).trim().toLowerCase();
  const shown = (clients ?? []).filter((c) => !q || `${c.name} ${c.company}`.toLowerCase().includes(q));

  return (
    <DetailPage backHref="/contacts" header={<DetailHeading avatar={<IconCircle icon={Briefcase} />} title="Team Clients" subtitle={clients?.length ? plural(clients.length, "Client") : undefined} />}>
      {clients === null ? (
        <LoadFailed icon={Briefcase} title="Team Clients Did Not Load" backHref="/contacts" backLabel="Back to Contacts" onRetry={reload} />
      ) : clients === undefined ? (
        <div className="flex flex-col gap-3" aria-label="Loading team clients">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      ) : !clients.length ? (
        <EmptyState icon={Briefcase} title="No Team Clients Yet" />
      ) : (
        <>
          <SearchBand value={search} onChange={setSearch} placeholder="Search Team Clients" maxLength={120} className="border-b-0 p-0" inputClassName="h-10 bg-background" />
          {shown.length ? (
            <Card>
              <Separated>
                {shown.map((c) => (
                  <ClientRow key={c.id} client={c} me={session?.user.id} full end={<ClientMenu client={c} onChanged={reload} />} />
                ))}
              </Separated>
            </Card>
          ) : (
            <EmptyState icon={Briefcase} title="No Matches" />
          )}
          <TeamCompanies onChanged={reload} />
        </>
      )}
    </DetailPage>
  );
}

export function TeamClientsPage() {
  return (
    <Suspense fallback={null}>
      <Clients />
    </Suspense>
  );
}
