"use client";

// The owner's and admin's side of the Team Clients page (step 6 of Teams), and the compliance export. Members see none of it:
// the menu is not drawn for them, and the database refuses every one of these calls from anyone who is not an owner or admin.
// Removing a client or company stops the sharing rule matching them and never unshares a chat.

import { useState } from "react";
import { Download, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { useMyTeam } from "@/lib/share";
import { useTeam } from "@/lib/team";
import { agentsText, useTeamClients, type TeamClient } from "@/lib/team-clients";
import { mergeClients, removeClient, removeCompany, renameClient, setClientAgent, setClientCompany, useTeamCompanies } from "@/lib/team-clients-manage";
import { download, exportClientHistory, type ExportProgress } from "@/lib/compliance-export";
import { buildExportHtml, buildExportJson, exportFileName, totals, type ExportDoc } from "@/lib/export-file";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";

type Action = "rename" | "company" | "agent" | "merge" | "remove" | "export";

/** The menu at the end of a client's row. Nothing for a member. */
export function ClientMenu({ client, onChanged }: { client: TeamClient; onChanged: () => void }) {
  const team = useMyTeam();
  const [action, setAction] = useState<Action | null>(null);
  const manages = team?.role === "owner" || team?.role === "admin";
  const exports = !!team?.strict && team?.role === "compliance";
  if (!team || (!manages && !exports)) return null;
  const close = () => setAction(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${client.name}`}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {manages && (
            <>
              <DropdownMenuItem onSelect={() => setAction("rename")}>Rename</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAction("company")}>Set Company</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAction("agent")}>Change Agent</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAction("merge")}>Merge With Another Client</DropdownMenuItem>
            </>
          )}
          {exports && <DropdownMenuItem onSelect={() => setAction("export")}>Export Work History</DropdownMenuItem>}
          {manages && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setAction("remove")}>Remove From Team List</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {action === "rename" && <RenameDialog client={client} onClose={close} onDone={onChanged} />}
      {action === "company" && <CompanyDialog client={client} onClose={close} onDone={onChanged} />}
      {action === "agent" && <AgentDialog client={client} onClose={close} onDone={onChanged} />}
      {action === "merge" && <MergeDialog client={client} onClose={close} onDone={onChanged} />}
      {action === "remove" && <RemoveClientDialog client={client} onClose={close} onDone={onChanged} />}
      {action === "export" && <ExportDialog client={client} onClose={close} />}
    </>
  );
}

function RenameDialog({ client, onClose, onDone }: { client: TeamClient; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(client.name);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    const failed = await renameClient(client.id, name);
    setBusy(false);
    if (failed) return void toast.error(failed);
    toast("Renamed");
    onDone();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent track="rename_team_client" className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename Client</DialogTitle>
            <DialogDescription>Everyone on the team sees the new name on the list. A person&apos;s own contact is not changed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="client-name">Name</Label>
            <Input id="client-name" autoFocus maxLength={120} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className={DIALOG_BUTTONS}>
            <Button type="submit" variant="secondary" disabled={busy || !name.trim() || name.trim() === client.name}>{busy ? "Saving" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompanyDialog({ client, onClose, onDone }: { client: TeamClient; onClose: () => void; onDone: () => void }) {
  const { companies } = useTeamCompanies();
  const [company, setCompany] = useState(client.company);
  const [busy, setBusy] = useState(false);
  const known = (companies ?? []).some((c) => c.name.toLowerCase() === company.trim().toLowerCase());
  const save = async (value: string | null) => {
    setBusy(true);
    const failed = await setClientCompany(client.id, value, companies ?? []);
    setBusy(false);
    if (failed) return void toast.error(failed);
    toast(value ? "Company saved" : "Company cleared");
    onDone();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent track="set_team_client_company" className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); if (!busy && company.trim()) void save(company); }} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Set Company</DialogTitle>
            <DialogDescription>
              The company shown beside {client.name} on the list. {known ? "This is a company the team already has, so they join it." : "A name you type is only a label on this client. It does not make anyone at that company a team client, so it changes no sharing."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="client-company">Company</Label>
            <Input id="client-company" autoFocus maxLength={120} list="team-companies" value={company} disabled={busy} onChange={(e) => setCompany(e.target.value)} />
            <datalist id="team-companies">{(companies ?? []).map((c) => <option key={c.domainIndex} value={c.name} />)}</datalist>
          </div>
          <div className={DIALOG_BUTTONS}>
            {client.company && <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>Clear Company</Button>}
            <Button type="submit" variant="secondary" disabled={busy || !company.trim() || company.trim() === client.company}>{busy ? "Saving" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AgentDialog({ client, onClose, onDone }: { client: TeamClient; onClose: () => void; onDone: () => void }) {
  const { state } = useTeam();
  const { session } = useAuth();
  const me = session?.user.id;
  const members = (state?.people ?? []).filter((p): p is typeof p & { userId: string } => p.status === "active" && !!p.userId && p.role !== "compliance");
  const [agent, setAgent] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!agent || busy) return;
    setBusy(true);
    const failed = await setClientAgent(client.id, agent);
    setBusy(false);
    if (failed) return void toast.error(failed);
    toast("Agent changed");
    onDone();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent track="set_team_client_agent" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change Agent</DialogTitle>
          <DialogDescription>
            Now looked after by {agentsText(client.agents, me)}. This changes the name beside {client.name} on the list. It does not move any chat: to give someone a client&apos;s chats, use Work Chats.
          </DialogDescription>
        </DialogHeader>
        {!state ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="client-agent">Looked After By</Label>
            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger id="client-agent" className="w-full"><SelectValue placeholder="Choose Someone" /></SelectTrigger>
              <SelectContent>{members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.userId === me ? "Me" : m.name || m.email}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className={DIALOG_BUTTONS}>
          <Button type="button" disabled={busy || !agent} onClick={() => void submit()}>{busy ? "Saving" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MergeDialog({ client, onClose, onDone }: { client: TeamClient; onClose: () => void; onDone: () => void }) {
  const { clients } = useTeamClients();
  const others = (clients ?? []).filter((c) => c.id !== client.id);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = others.find((c) => c.id === other);
  const submit = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    const failed = await mergeClients(client.id, chosen.id);
    setBusy(false);
    if (failed) return void toast.error(failed);
    toast(`${chosen.name} merged into ${client.name}`);
    onDone();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent track="merge_team_clients" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Merge Clients</DialogTitle>
          <DialogDescription>
            Choose the other entry for the same person. Its addresses, numbers and agents join {client.name}, which keeps its name. No chat is changed.
          </DialogDescription>
        </DialogHeader>
        {clients === undefined ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="merge-with">Merge Into {client.name}</Label>
            <Select value={other} onValueChange={setOther}>
              <SelectTrigger id="merge-with" className="w-full"><SelectValue placeholder="Choose a Client" /></SelectTrigger>
              <SelectContent>{others.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.company ? `, ${c.company}` : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className={DIALOG_BUTTONS}>
          <Button type="button" disabled={busy || !chosen} onClick={() => void submit()}>{busy ? "Merging" : "Merge"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RemoveClientDialog({ client, onClose, onDone }: { client: TeamClient; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const failed = await removeClient(client.id);
    setBusy(false);
    if (failed) return void toast.error(failed);
    toast(`${client.name} removed from the list`);
    onDone();
    onClose();
  };
  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent track="remove_team_client">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {client.name} From the Team List?</AlertDialogTitle>
          <AlertDialogDescription>
            The sharing rule stops matching their addresses and numbers, so a new chat with them is no longer shared automatically. Chats already shared stay shared, and nothing in them is changed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className={DIALOG_BUTTONS}>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={(e) => { e.preventDefault(); void submit(); }}>{busy ? "Removing" : "Remove"}</AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Client companies, for an owner or admin: the companies whose people the sharing rule matches, each removable. */
export function TeamCompanies({ onChanged }: { onChanged: () => void }) {
  const team = useMyTeam();
  const manages = team?.role === "owner" || team?.role === "admin";
  const { companies, reload } = useTeamCompanies(manages);
  const [removing, setRemoving] = useState<{ domainIndex: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!manages || !companies?.length) return null;
  const submit = async () => {
    if (!removing) return;
    setBusy(true);
    const failed = await removeCompany(removing.domainIndex);
    setBusy(false);
    if (failed) return void toast.error(failed);
    toast(`${removing.name} removed from the list`);
    setRemoving(null);
    reload();
    onChanged();
  };
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium">Client Companies</h2>
      <p className="text-xs text-muted-foreground">Anyone writing from one of these companies is treated as a team client, and their chats are shared by the rule. Remove one to stop that. Chats already shared stay shared.</p>
      <div className="divide-y overflow-hidden rounded-lg border">
        {companies.map((c) => (
          <div key={c.domainIndex} className="flex items-center justify-between gap-3 px-4 py-2">
            <span className="min-w-0 truncate text-sm">{c.name}</span>
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoving(c)}>Remove</Button>
          </div>
        ))}
      </div>
      <AlertDialog open={!!removing} onOpenChange={(open) => !busy && !open && setRemoving(null)}>
        <AlertDialogContent track="remove_team_company">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name} From the Team List?</AlertDialogTitle>
            <AlertDialogDescription>
              The sharing rule stops matching people at this company. Clients who had it keep their place on the list without a company. Chats already shared stay shared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={(e) => { e.preventDefault(); void submit(); }}>{busy ? "Removing" : "Remove"}</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Exports one client's work history for the records a regulated firm must keep. It says plainly what it reads and who is told,
 * does the reading here in the browser (compliance-export.ts), and offers the file as a readable HTML document (print it or
 * save it as a PDF) and a JSON copy. Nothing readable goes to Konva.
 */
function ExportDialog({ client, onClose }: { client: TeamClient; onClose: () => void }) {
  const { state } = useTeam();
  const { session } = useAuth();
  const { profile } = useApp();
  const [phase, setPhase] = useState<"ready" | "working" | "done" | "failed">("ready");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [doc, setDoc] = useState<ExportDoc | null>(null);
  const [reason, setReason] = useState("");
  const working = phase === "working";

  const start = async () => {
    setPhase("working");
    const out = await exportClientHistory({
      client: { id: client.id, name: client.name, company: client.company },
      workspace: state?.workspace?.name ?? "Team",
      exportedBy: profile.name || session?.user.email || "Someone",
      onProgress: setProgress,
    });
    if ("problem" in out) {
      setReason(out.problem);
      return setPhase("failed");
    }
    setDoc(out.doc);
    setPhase("done");
  };

  const t = doc ? totals(doc) : null;
  const pct = progress && progress.messagesTotal > 0 ? Math.min(100, Math.round((progress.messages / progress.messagesTotal) * 100)) : 0;
  return (
    <Dialog open onOpenChange={(open) => !open && !working && onClose()}>
      <DialogContent track="compliance_export" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Work History</DialogTitle>
          <DialogDescription>
            {phase === "done" && t
              ? `${t.chats} ${t.chats === 1 ? "chat" : "chats"}, ${t.messages} ${t.messages === 1 ? "message" : "messages"} and ${t.notes} ${t.notes === 1 ? "note" : "notes"} with ${client.name}.`
              : `Every work chat your team has with ${client.name}, across agents and shared inboxes: email and WhatsApp, with dates, senders, text and notes.`}
          </DialogDescription>
        </DialogHeader>
        {phase === "ready" && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Only work chats, and only from each chat&apos;s Share From date. Personal chats never appear.</li>
            <li>The file is built here in your browser. Nothing readable goes to Konva.</li>
            <li>The export is logged with who exported which client, when, and how many messages, never any text. Owners and admins can see the log.</li>
            <li>The agent whose chat is included is told, in What You Share.</li>
          </ul>
        )}
        {working && (
          <div className="space-y-2" role="status">
            <Progress value={pct} />
            <p className="text-sm text-muted-foreground">
              {progress ? `Reading messages, ${progress.messages} of ${progress.messagesTotal}. Chat ${Math.min(progress.chatsDone + 1, progress.chats)} of ${progress.chats}.` : "Starting"}
            </p>
          </div>
        )}
        {phase === "done" && doc && (
          <div className="space-y-3">
            {doc.chats.some((c) => c.notYetShared > 0) && (
              <p className="text-sm text-muted-foreground">Some messages were still being shared and are not in this file. Export again once sharing has finished.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => download(exportFileName(doc, "html"), "text/html;charset=utf-8", buildExportHtml(doc))}><Download /> Download HTML</Button>
              <Button variant="secondary" onClick={() => download(exportFileName(doc, "json"), "application/json", buildExportJson(doc))}><Download /> Download JSON</Button>
            </div>
            <p className="text-xs text-muted-foreground">Open the HTML file and print it, or save it as a PDF, for a record to keep.</p>
          </div>
        )}
        {phase === "failed" && <p className="text-sm text-destructive" role="alert">{reason}</p>}
        {phase === "ready" && (
          <div className={DIALOG_BUTTONS}>
            <Button type="button" onClick={() => void start()}>Start Export</Button>
          </div>
        )}
        {phase === "done" && (
          <div className={DIALOG_BUTTONS}>
            <Button type="button" onClick={onClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
