"use client";

// Settings, Team, Work Chats: every work chat for owners and admins to find a client and reassign it, without showing any chat text.

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { relTime } from "@/lib/format";
import { assignAgentChats, assignThread, unassignThread, useWorkChats, WORK_FILTERS, type WorkChat, type WorkFilter } from "@/lib/team-work";
import type { TeamState } from "@/lib/team";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";

const CHANNEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn", instagram: "Instagram", teams: "Teams", zoom: "Zoom", google_chat: "Google Chat" };

/**
 * Every work chat in the team, for an owner or admin to find a client and hand them to someone, and for Compliance (under
 * strict sharing) to open. It carries who it is with, who looks after it, when it last moved and who it is assigned to,
 * never a word of the chat: an owner or admin opens one only once it is assigned to them. When someone has left, their
 * clients are listed first and can be given to one person in one go.
 */
export function WorkChatsSection({ team, userId }: { team: TeamState; userId: string }) {
  const [filter, setFilter] = useState<WorkFilter>("all");
  const { chats, total, counts, leftAgents, failed, more, load, loadMore } = useWorkChats(filter);
  const [search, setSearch] = useState("");
  const [reassigning, setReassigning] = useState<{ id: string; name: string; chats: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const manages = team.role === "owner" || team.role === "admin";

  // Active members a chat can go to. Compliance reads everything already, so it is never given a chat.
  const members = team.people.filter((p): p is typeof p & { userId: string } => p.status === "active" && !!p.userId && p.role !== "compliance");
  const nameOf = (id: string) => {
    const p = team.people.find((x) => x.userId === id);
    return id === userId ? "You" : p?.name || p?.email || "Someone";
  };

  const act = async (work: () => Promise<string | null>, done: string) => {
    setBusy(true);
    const problem = await work();
    setBusy(false);
    if (problem) return void toast.error(problem);
    toast(done);
    void load();
  };
  const assign = (c: WorkChat, id: string) => void act(() => assignThread(c.threadId, id), id === userId ? "Assigned to you. You can open it now." : `Assigned to ${nameOf(id)}`);
  const unassign = (c: WorkChat, id: string) => void act(() => unassignThread(c.threadId, id), `${nameOf(id)} no longer has this chat`);

  const term = search.trim().toLowerCase();
  const shown = (chats ?? []).filter((c) => !term || `${c.label} ${c.agentName} ${c.inboxName ?? ""}`.toLowerCase().includes(term));

  return (
    <SettingsSection
      id="work-chats"
      title="Work Chats"
      description={manages
        ? "Every chat your team has marked as work, with who looks after it. You see that a chat exists and who it is with, never what was said. To read one, assign it to yourself."
        : "Every work chat in the team. Opening one is logged: the agent whose chat it is can see that Compliance opened it, and on which day."}
    >
      {failed && !chats ? (
        <Alert variant="destructive">
          <AlertTitle>Could Not Load Work Chats</AlertTitle>
          <AlertDescription>
            <p>Check your connection and try again.</p>
            <Button variant="secondary" className="mt-2" onClick={() => void load()}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {manages && leftAgents.length > 0 && (
        <Alert>
          <AlertTitle>{leftAgents.length === 1 ? `${leftAgents[0].name} Has Left the Team` : "Some People Have Left the Team"}</AlertTitle>
          <AlertDescription>
            <p>Their clients stay with the team. Give each person&apos;s chats to someone who can read them and reply.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {leftAgents.map((a) => (
                <Button key={a.id} variant="secondary" disabled={busy} onClick={() => setReassigning(a)}>
                  Reassign {a.name}&apos;s {a.chats === 1 ? "Chat" : `${a.chats} Chats`}
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filter} onValueChange={(v) => setFilter(v as WorkFilter)}>
          <SelectTrigger aria-label="Show" className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            {WORK_FILTERS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label} ({counts[f.key]})</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Clients or Agents" aria-label="Search Work Chats" className="w-64 max-w-full" />
      </div>

      {!chats ? (
        failed ? null : <Skeleton className="h-40 w-full rounded-lg" />
      ) : chats.length === 0 ? (
        <SettingsEmpty>{filter === "all" ? "No work chats yet. A chat appears here once someone on the team marks it as work." : "Nothing matches this filter."}</SettingsEmpty>
      ) : shown.length === 0 ? (
        <SettingsEmpty>No chat on this page matches your search.</SettingsEmpty>
      ) : (
        <SettingsRows>
          {shown.map((c) => {
            const mine = c.assigneeIds.includes(userId);
            const options = members.filter((m) => !c.assigneeIds.includes(m.userId));
            return (
              <SettingsRow
                key={c.threadId}
                title={
                  <>
                    {c.label || "Chat"}
                    <Badge variant="outline">{CHANNEL[c.channel] ?? c.channel}</Badge>
                    {c.sharedBy === "account" && <Badge variant="outline">Shared Inbox</Badge>}
                    {c.awaiting && <Badge variant="secondary">Awaiting Reply</Badge>}
                    {c.agentLeft && <Badge variant="destructive">Agent Has Left</Badge>}
                  </>
                }
                description={[
                  c.sharedBy === "account" ? `Inbox ${c.inboxName ?? ""}`.trim() : c.agentLeft ? `${c.agentName} left the team` : `Agent ${c.agentId === userId ? "You" : c.agentName}`,
                  c.lastMessageAt ? `Last message ${relTime(c.lastMessageAt)}` : "No messages yet",
                  c.assigneeIds.length ? `Assigned to ${c.assigneeIds.map(nameOf).join(", ")}` : "Not assigned to anyone",
                ].join(", ")}
              >
                {manages ? (
                  <>
                    {options.length > 0 && (
                      <Select value="" onValueChange={(id) => assign(c, id)} disabled={busy}>
                        <SelectTrigger className="w-36" aria-label={`Assign ${c.label || "Chat"}`}><SelectValue placeholder="Assign To" /></SelectTrigger>
                        <SelectContent>
                          {options.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.userId === userId ? "Me" : m.name || m.email}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    {c.assigneeIds.length > 0 && (
                      <Select value="" onValueChange={(id) => unassign(c, id)} disabled={busy}>
                        <SelectTrigger className="w-36" aria-label={`Take ${c.label || "Chat"} back`}><SelectValue placeholder="Take Back From" /></SelectTrigger>
                        <SelectContent>
                          {c.assigneeIds.map((id) => <SelectItem key={id} value={id}>{id === userId ? "Me" : nameOf(id)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    {mine ? (
                      <Button variant="secondary" asChild><Link href={`/inbox/shared/${c.threadId}?from=work`}>Open</Link></Button>
                    ) : (
                      <Button variant="secondary" disabled title="Assign this chat to yourself to open it">Open</Button>
                    )}
                  </>
                ) : (
                  <Button variant="secondary" asChild><Link href={`/inbox/shared/${c.threadId}?from=work`}>Open</Link></Button>
                )}
              </SettingsRow>
            );
          })}
        </SettingsRows>
      )}
      {chats && chats.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{chats.length < total ? `Showing ${chats.length} of ${total}.` : `${total} ${total === 1 ? "chat" : "chats"}.`}</p>
          {more && <Button variant="secondary" onClick={() => void loadMore()}>Show More</Button>}
        </div>
      )}

      <ReassignDialog
        agent={reassigning}
        members={members.map((m) => ({ id: m.userId, name: m.userId === userId ? "Me" : m.name || m.email }))}
        onClose={() => setReassigning(null)}
        onDone={() => { setReassigning(null); void load(); }}
      />
    </SettingsSection>
  );
}

/** Gives all of one departed agent's chats to a person. */
function ReassignDialog({ agent, members, onClose, onDone }: { agent: { id: string; name: string; chats: number } | null; members: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!agent || !to || busy) return;
    setBusy(true);
    const out = await assignAgentChats(agent.id, to);
    setBusy(false);
    if ("problem" in out) return void toast.error(out.problem);
    toast(out.assigned === 0 ? "They already had every one of these chats" : `${out.assigned} ${out.assigned === 1 ? "chat" : "chats"} assigned`);
    setTo("");
    onDone();
  };
  return (
    <Dialog open={!!agent} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent showCloseButton={false} track="reassign_agent_chats" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reassign {agent?.name}&apos;s Chats</DialogTitle>
          <DialogDescription>
            The person you choose can read all {agent?.chats} of their work chats, and answer each client from their own account. Their history stays here. A client who has {agent?.name}&apos;s own number can still message it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="reassign-to">Assign To</Label>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger id="reassign-to" className="w-full"><SelectValue placeholder="Choose Someone" /></SelectTrigger>
            <SelectContent>{members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className={DIALOG_BUTTONS}>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="secondary" type="button" disabled={busy || !to} onClick={() => void submit()}>{busy ? "Assigning" : "Assign All"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
