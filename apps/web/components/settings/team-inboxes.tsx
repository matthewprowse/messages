"use client";

// Settings, Team, Shared Inboxes: make one from a connected account and choose who may use it.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Inbox, Plus } from "lucide-react";
import { toast } from "sonner";
import { loadShareableAccounts, setInboxAccess, shareAccount, useSharedInboxes, type ShareableAccount, type SharedInbox } from "@/lib/team-work";
import type { TeamState } from "@/lib/team";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";

const PROVIDER: Record<string, string> = { gmail: "Gmail", outlook: "Outlook", imap: "Email", icloud: "iCloud+ Mail", whatsapp: "WhatsApp" };

/** Who can use one inbox. The person who connected it always can. */
function AccessDialog({ inbox, team, onClose, onSaved }: { inbox: SharedInbox | null; team: TeamState; onClose: () => void; onSaved: () => void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (inbox) setChosen(new Set(inbox.access.map((a) => a.userId))); }, [inbox]);
  // Compliance reads through its own log and never replies, so it is not offered.
  const members = team.people.filter((p): p is typeof p & { userId: string } => p.status === "active" && !!p.userId && p.role !== "compliance");
  const connector = inbox?.connectedById;
  const toggle = (id: string, on: boolean) => setChosen((c) => { const next = new Set(c); if (on) next.add(id); else next.delete(id); return next; });
  const save = async () => {
    if (!inbox || busy) return;
    setBusy(true);
    const problem = await setInboxAccess(inbox.accountId, [...chosen]);
    setBusy(false);
    if (problem) return void toast.error(problem);
    toast("Access saved");
    onSaved();
  };
  return (
    <Dialog open={!!inbox} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent track="inbox_access" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Who Uses {inbox?.name}</DialogTitle>
          <DialogDescription>
            Everyone chosen reads every chat in this inbox, assigns chats, adds internal notes and replies from the shared account. Taking someone off also takes back the chats assigned to them here.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-3 overflow-y-auto">
          {members.map((m) => {
            const fixed = m.userId === connector;
            return (
              <div key={m.userId} className="flex items-center gap-3">
                <Checkbox id={`access-${m.userId}`} checked={fixed || chosen.has(m.userId)} disabled={fixed || busy} onCheckedChange={(v) => toggle(m.userId, v === true)} />
                <Label htmlFor={`access-${m.userId}`} className="flex-1 font-normal">{m.name || m.email}{fixed && <span className="ml-2 text-xs text-muted-foreground">Connected this inbox</span>}</Label>
              </div>
            );
          })}
        </div>
        <div className={DIALOG_BUTTONS}>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="secondary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Turns one of your own connected accounts into the team's shared inbox. */
function ShareDialog({ open, onClose, onShared }: { open: boolean; onClose: () => void; onShared: () => void }) {
  const [accounts, setAccounts] = useState<ShareableAccount[] | null>(null);
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setAccount(""); setName(""); setAccounts(null);
    void loadShareableAccounts().then(setAccounts);
  }, [open]);
  const submit = async () => {
    if (!account || !name.trim() || busy) return;
    setBusy(true);
    const out = await shareAccount(account, name.trim());
    setBusy(false);
    if ("problem" in out) return void toast.error(out.problem);
    toast(out.shared === 1 ? "Shared inbox ready. 1 chat is being shared." : `Shared inbox ready. ${out.shared} chats are being shared.`);
    onShared();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent track="share_account" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Make a Shared Inbox</DialogTitle>
          <DialogDescription>
            Use an account the business owns, such as info@ or the business WhatsApp number. Every chat on it, from the first message to the next one, is shared with the people you give access to. This cannot be undone here, and a personal account should not be used.
          </DialogDescription>
        </DialogHeader>
        {accounts && accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Connect the account first, then come back. <Link href="/settings/accounts" className="underline underline-offset-4">Connected Accounts</Link>
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="inbox-account">Account</Label>
              <Select value={account} onValueChange={(v) => { setAccount(v); setName((n) => n || accounts?.find((a) => a.id === v)?.label || ""); }} disabled={!accounts}>
                <SelectTrigger id="inbox-account" className="w-full"><SelectValue placeholder={accounts ? "Choose an Account" : "Loading"} /></SelectTrigger>
                <SelectContent>{(accounts ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.label} ({PROVIDER[a.provider] ?? a.provider})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inbox-name">Name</Label>
              <Input id="inbox-name" value={name} maxLength={80} placeholder="Sales" onChange={(e) => setName(e.target.value)} />
              <p className="text-xs text-muted-foreground">What the team sees it as. It is shown in plain text to every member.</p>
            </div>
          </div>
        )}
        <div className={DIALOG_BUTTONS}>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="secondary" type="button" disabled={busy || !account || !name.trim()} onClick={() => void submit()}>{busy ? "Sharing" : "Make Shared Inbox"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The team's shared inboxes in Settings, Team. An owner or admin makes one from an account they connected and chooses who
 * can use it; everyone else with access sees which they can use, which open from the Inbox.
 */
export function SharedInboxesSection({ team }: { team: TeamState }) {
  const { inboxes, failed, load } = useSharedInboxes();
  const [sharing, setSharing] = useState(false);
  const [managing, setManaging] = useState<SharedInbox | null>(null);
  const manages = team.role === "owner" || team.role === "admin";
  if (team.role === "compliance") return null;
  // A member with no access and nothing to manage has nothing to read here.
  if (!manages && inboxes && inboxes.length === 0) return null;

  return (
    <SettingsSection
      id="inboxes"
      title="Shared Inboxes"
      description="An account the business owns, such as info@ or the business WhatsApp number. Every chat on it is shared with the people you choose, who can assign chats, add internal notes and reply from it."
    >
      {manages && <div><Button variant="secondary" onClick={() => setSharing(true)}><Plus /> Make Shared Inbox</Button></div>}
      {failed && !inboxes ? (
        <Alert variant="destructive">
          <AlertTitle>Could Not Load Shared Inboxes</AlertTitle>
          <AlertDescription>
            <p>Check your connection and try again.</p>
            <Button variant="secondary" className="mt-2" onClick={() => void load()}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : !inboxes ? (
        <Skeleton className="h-20 w-full rounded-lg" />
      ) : inboxes.length === 0 ? (
        <SettingsEmpty>No shared inbox yet. Connect the business account in Connected Accounts, then make it a shared inbox here.</SettingsEmpty>
      ) : (
        <SettingsRows>
          {inboxes.map((i) => (
            <SettingsRow
              key={i.accountId}
              leading={<Inbox className="size-4 text-muted-foreground" />}
              title={
                <>
                  {i.name}
                  <Badge variant="outline">{PROVIDER[i.provider] ?? i.provider}</Badge>
                  {(i.status === "error" || i.status === "disconnected") && <Badge variant="destructive">Needs Attention</Badge>}
                  {i.hasAccess && i.awaiting > 0 && <Badge variant="secondary">{i.awaiting} Awaiting Reply</Badge>}
                </>
              }
              description={manages
                ? `Connected by ${i.connectedBy}. ${i.access.length === 1 ? "1 person uses it" : `${i.access.length} people use it`}${i.access.length ? `: ${i.access.map((a) => a.name).join(", ")}` : ""}.`
                : `Connected by ${i.connectedBy}. Open it from your Inbox.`}
            >
              {manages && <Button variant="secondary" onClick={() => setManaging(i)}>Who Uses It</Button>}
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      <ShareDialog open={sharing} onClose={() => setSharing(false)} onShared={() => { setSharing(false); void load(); }} />
      <AccessDialog inbox={managing} team={team} onClose={() => setManaging(null)} onSaved={() => { setManaging(null); void load(); }} />
    </SettingsSection>
  );
}
