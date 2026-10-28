"use client";

// Team Clients on the Contacts page: the clients everyone on the team looks after, with their company and the agent
// or agents who look after them. A row above People opens this page, so the person's own contacts are untouched. It
// holds names only: a chat is read by its agent and whoever it is assigned to, and an assigned chat is in the
// assignee's Conversations (step 5), never here.

import { Suspense, useDeferredValue, useState } from "react";
import { Briefcase } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMyTeam } from "@/lib/share";
import { agentsText, useTeamClients } from "@/lib/team-clients";
import { cn, withQuery } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { DetailPage, Divided, LoadFailed, plural, ListRow } from "@/components/contact-list";
import { ClientMenu, TeamCompanies } from "@/components/team-client-manage";

const HREF = "/contacts/team";

/** The row above People for someone in a team. */
export function TeamClientsRow({ selected, query }: { selected: boolean; query: string }) {
  const team = useMyTeam();
  if (!team) return null;
  return (
    <>
      <ListRow
        href={withQuery(HREF, query)}
        avatar={
          <div className={cn("flex size-10 items-center justify-center rounded-full", selected ? "bg-background" : "bg-muted")}>
            <Briefcase className="size-4" />
          </div>
        }
        title="Team Clients"
        detail="Everyone your team looks after"
        selected={selected}
      />
      <div className="my-2 pl-16"><Separator /></div>
    </>
  );
}

function Clients() {
  const { session } = useAuth();
  const { clients, reload } = useTeamClients();
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search).trim().toLowerCase();
  const shown = (clients ?? []).filter((c) => !q || `${c.name} ${c.company}`.toLowerCase().includes(q));

  return (
    <DetailPage backHref="/contacts" header={<h1 className="min-w-0 flex-1 truncate text-lg font-medium">Team Clients</h1>}>
      {clients === null ? (
        <LoadFailed icon={Briefcase} title="Team Clients Did Not Load" backHref="/contacts" backLabel="Back to Contacts" onRetry={reload} />
      ) : clients === undefined ? (
        <div className="space-y-3" aria-label="Loading team clients">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !clients.length ? (
        <EmptyState icon={Briefcase} title="No Team Clients Yet" description="Clients appear here when someone on your team marks a chat with them as work." />
      ) : (
        <>
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setSearch(""); e.currentTarget.blur(); } }}
            placeholder="Search Team Clients"
            aria-label="Search Team Clients"
            maxLength={120}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            {plural(clients.length, "client")} your team looks after. Only names, companies and who looks after them are shared here. Messages stay with the chat and the agent it belongs to.
          </p>
          {shown.length ? (
            <div className="-mx-3 flex flex-col gap-2">
              <Divided className="pr-3 pl-16">
                {shown.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-lg p-3">
                    <ContactAvatar contact={{ isCompany: false }} className="size-10" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm font-medium">{c.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[c.company, `Looked after by ${agentsText(c.agents, session?.user.id)}`].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <ClientMenu client={c} onChanged={reload} />
                  </div>
                ))}
              </Divided>
            </div>
          ) : (
            <EmptyState icon={Briefcase} title="No Matches" description={`Nothing matches "${search.trim()}".`} />
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
