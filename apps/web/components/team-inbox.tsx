"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { relTime } from "@/lib/format";
import { useMyTeam } from "@/lib/share";
import { useAssignedChats, useInboxChats, type AssignedChat, type TeamChatRow } from "@/lib/shared-chat";
import { useSharedInboxes, type SharedInbox } from "@/lib/team-work";
import { cn, withQuery } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// What the team puts in your Inbox (step 5 of Teams), above your own conversations: chats assigned to you, with the name of
// the agent whose chat each is, and the shared inboxes you use. They open read-only in /inbox/shared. Your own
// conversations are not here and nothing of theirs is mixed into your own list: these are a separate group.

const SHOWN = 5;

function Row({ chat, who, query, selected }: { chat: TeamChatRow; who: string; query: string; selected: boolean }) {
  const mine = chat.assignees.length ? `Assigned to ${chat.assignees.map((a) => a.name).join(", ")}` : "";
  return (
    <Link
      href={withQuery(`/inbox/shared/${chat.threadId}`, query)}
      aria-current={selected ? "page" : undefined}
      className={cn("flex flex-col gap-1 rounded-lg p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", selected ? "bg-muted" : "hover:bg-muted/50")}
    >
      <div className="flex h-5 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{chat.label || "Chat"}</span>
          {chat.awaiting && <Badge variant="secondary">Awaiting Reply</Badge>}
        </span>
        {chat.lastMessageAt && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relTime(chat.lastMessageAt)}</span>}
      </div>
      <div className="flex h-4 items-center justify-between gap-3">
        <span className="min-w-0 truncate text-xs">{chat.preview || who}</span>
        <span className="shrink-0 truncate text-xs text-muted-foreground">{chat.preview ? who : mine}</span>
      </div>
    </Link>
  );
}

function GroupHeader({ title, count, open, onToggle, children }: { title: string; count?: number; open: boolean; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Button variant="ghost" size="sm" className="-ml-2 px-2 text-xs font-medium text-muted-foreground" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown /> : <ChevronRight />}
        {title}{count ? ` (${count})` : ""}
      </Button>
      {children}
    </div>
  );
}

/** Chats assigned to you, with the agent each belongs to. */
function Assigned({ chats, query, selectedId }: { chats: AssignedChat[]; query: string; selectedId?: string }) {
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const shown = all ? chats : chats.slice(0, SHOWN);
  return (
    <div className="flex flex-col gap-1">
      <GroupHeader title="Assigned To You" count={chats.length} open={open} onToggle={() => setOpen((o) => !o)} />
      {open && (
        <>
          {shown.map((c) => <Row key={c.threadId} chat={c} who={c.inboxName ? `Inbox ${c.inboxName}` : c.agentLeft ? `${c.agentName} (left)` : c.coverUntil ? `${c.agentName} (covering)` : c.agentName} query={query} selected={selectedId === c.threadId} />)}
          {chats.length > SHOWN && <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll((a) => !a)}>{all ? "Show Fewer" : `Show All ${chats.length}`}</Button>}
        </>
      )}
    </div>
  );
}

/** The shared inboxes you use: pick one, read its newest chats, and take a chat for yourself. */
function Inboxes({ mine, query, selectedId }: { mine: SharedInbox[]; query: string; selectedId?: string }) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const chosen = mine.find((i) => i.accountId === account) ?? mine[0];
  const { chats, more, loadMore } = useInboxChats(open && chosen ? chosen.accountId : null);
  useEffect(() => { if (selectedId && chats?.some((c) => c.threadId === selectedId)) setOpen(true); }, [selectedId, chats]);
  const waiting = mine.reduce((n, i) => n + i.awaiting, 0);
  return (
    <div className="flex flex-col gap-1">
      <GroupHeader title={mine.length === 1 ? `Shared Inbox` : "Shared Inboxes"} count={waiting} open={open} onToggle={() => setOpen((o) => !o)}>
        {open && mine.length > 1 && (
          <Select value={chosen?.accountId ?? ""} onValueChange={setAccount}>
            <SelectTrigger size="sm" aria-label="Shared Inbox" className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{mine.map((i) => <SelectItem key={i.accountId} value={i.accountId}>{i.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </GroupHeader>
      {open && chosen && (
        <>
          {mine.length === 1 && <p className="px-3 text-xs text-muted-foreground">{chosen.name}. {chosen.awaiting > 0 ? `${chosen.awaiting} waiting for a reply.` : "Nothing is waiting."}</p>}
          {!chats ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Loading</p>
          ) : chats.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No chats in this inbox yet.</p>
          ) : (
            chats.map((c) => <Row key={c.threadId} chat={c} who={c.assignees.length ? c.assignees.map((a) => a.name).join(", ") : "Not assigned"} query={query} selected={selectedId === c.threadId} />)
          )}
          {more && <Button variant="ghost" size="sm" className="self-start" onClick={() => void loadMore()}>Show More</Button>}
        </>
      )}
    </div>
  );
}

function Groups({ query, selectedId }: { query: string; selectedId?: string }) {
  const { chats } = useAssignedChats();
  const { inboxes } = useSharedInboxes();
  const mine = (inboxes ?? []).filter((i) => i.hasAccess);
  if (!chats?.length && !mine.length) return null;
  return (
    <div className="mb-3 flex flex-col gap-2 border-b pb-3">
      {!!chats?.length && <Assigned chats={chats} query={query} selectedId={selectedId} />}
      {mine.length > 0 && <Inboxes mine={mine} query={query} selectedId={selectedId} />}
    </div>
  );
}

/** The team's groups above your own conversations. Only for someone in a team, only in the All view, and not while searching. */
export function TeamInbox({ query, hidden }: { query: string; hidden: boolean }) {
  const team = useMyTeam();
  const params = useParams<{ id?: string }>();
  const onShared = usePathname().startsWith("/inbox/shared/");
  if (hidden || !team || team.role === "compliance") return null;
  return <Groups query={query} selectedId={onShared ? params.id : undefined} />;
}
