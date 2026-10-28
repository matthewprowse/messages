"use client";

import Link from "next/link";
import { useState } from "react";
import { Mail, Calendar, ListChecks, MessageCircle, RefreshCw, Video } from "lucide-react";
import { useApp } from "@/lib/store";
import { relTime } from "@/lib/format";
import type { Account } from "@/lib/types";
import { FAMILY_NAME, groupAccounts, groupProblem, groupStatus, partsOf, type AccountGroup } from "@/lib/account-groups";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";
import { SendAddressesSection } from "@/components/settings/send-addresses";

const ICON = { icloud: Mail, gmail: Mail, outlook: Mail, google_calendar: Calendar, outlook_calendar: Calendar, icloud_calendar: Calendar, whatsapp: MessageCircle,
  imap: Mail, teams: Video, zoom: Video, google_meet: Video, linkedin: MessageCircle, instagram: MessageCircle,
  microsoft_todo: ListChecks, google_tasks: ListChecks, icloud_reminders: ListChecks,
} as const;
const SETUP = {
  icloud: "/settings/accounts/icloud",
  gmail: "/settings/accounts/google",
  google_calendar: "/settings/accounts/google",
  outlook: "/settings/accounts/microsoft",
  outlook_calendar: "/settings/accounts/microsoft",
  icloud_calendar: "/settings/accounts/icloud-calendar",
  whatsapp: "/settings/accounts/whatsapp",
  imap: "/settings/accounts/imap",
  teams: "/settings/accounts/microsoft",
  zoom: "/settings/accounts/zoom",
  google_meet: "/settings/accounts/google",
  linkedin: "/settings/accounts/linkedin",
  instagram: "/settings/accounts/instagram",
  microsoft_todo: "/settings/accounts/microsoft",
  google_tasks: "/settings/accounts/google",
  icloud_reminders: "/settings/accounts/icloud-reminders",
} as const;

const FAMILY_SETUP = { google: "/settings/accounts/google", microsoft: "/settings/accounts/microsoft", apple: "/settings/accounts/icloud" } as const;
const setupOf = (g: AccountGroup) => (g.family in FAMILY_SETUP ? FAMILY_SETUP[g.family as keyof typeof FAMILY_SETUP] : SETUP[g.accounts[0].provider]);

function StatusBadge({ status }: { status: Account["status"] }) {
  if (status === "connected") return <Badge variant="secondary">Connected</Badge>;
  if (status === "syncing") return <Badge variant="outline" className="gap-1"><RefreshCw className="size-3 animate-spin" /> Syncing</Badge>;
  if (status === "connecting") return <Badge variant="outline" className="gap-1"><RefreshCw className="size-3 animate-spin" /> Connecting</Badge>;
  if (status === "error") return <Badge variant="destructive">Needs Attention</Badge>;
  return <Badge variant="outline">Sync Paused</Badge>;
}

function RowIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><Icon className="size-4" /></div>;
}

export default function AccountsPage() {
  const { accounts, loading, dispatch, notify } = useApp();
  const [pausing, setPausing] = useState<AccountGroup | null>(null);
  const [renaming, setRenaming] = useState<AccountGroup | null>(null);
  const [name, setName] = useState("");
  const rename = () => {
    if (!renaming) return;
    for (const a of renaming.accounts) dispatch({ type: "patchAccount", id: a.id, patch: { nickname: name.trim() } });
    setRenaming(null);
  };
  const pause = () => {
    if (!pausing) return;
    for (const a of pausing.accounts) dispatch({ type: "patchAccount", id: a.id, patch: { status: "disconnected" } });
    notify(`Sync paused for ${nameOf(pausing)}`);
    setPausing(null);
  };
  const groups = groupAccounts(accounts);
  const nameOf = (g: AccountGroup) => g.accounts.find((a) => a.nickname)?.nickname || FAMILY_NAME[g.family] || g.accounts[0].label;
  return (
    <>
      <SettingsHeader
        title="Connected Accounts"
        description={<>
          <p>Your email, calendars and WhatsApp in one place. Nothing is ever sent without you.</p>
          <p className="mt-1 text-xs">Read over IMAP, CalDAV, the Gmail API, Microsoft Graph and a linked WhatsApp device.</p>
        </>}
      />
      <div className="space-y-8">
        {groups.length === 0 ? (loading ? <Skeleton className="h-40 w-full rounded-lg" /> : <SettingsEmpty>No accounts connected yet.</SettingsEmpty>) : (
          <SettingsRows>
            {groups.map((g) => {
              const status = groupStatus(g);
              const problem = groupProblem(g);
              const first = g.accounts[0];
              return (
                <SettingsRow
                  key={g.key}
                  leading={<RowIcon icon={ICON[first.provider]} />}
                  title={<>{nameOf(g)} <StatusBadge status={status} /></>}
                  description={
                    <>
                      <span className="block truncate">{[g.accounts.length > 1 ? partsOf(g) : "", g.accounts.map((a) => a.detail).find((d) => d && !d.startsWith("urn:"))].filter(Boolean).join(" · ")}{first.lastSync && status === "connected" ? ` · Last synced ${relTime(first.lastSync)}` : ""}</span>
                      {problem && status !== "connected" && <span className="block">{problem}</span>}
                    </>
                  }
                >
                  <Button variant="ghost" size="sm" onClick={() => { setName(g.accounts.find((a) => a.nickname)?.nickname ?? ""); setRenaming(g); }}>Rename</Button>
                  {status === "disconnected" || status === "error" ? (
                    <Button size="sm" asChild><Link href={setupOf(g)}>Reconnect</Link></Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setPausing(g)}>Pause Sync</Button>
                  )}
                </SettingsRow>
              );
            })}
          </SettingsRows>
        )}

        <SettingsSection id="add-account" title="Add an Account">
          <SettingsRows>
            {[
              { href: "/settings/accounts/google", label: "Google", sub: "Gmail, Calendar and Tasks, with one sign-in", icon: ICON.gmail },
              { href: "/settings/accounts/microsoft", label: "Microsoft", sub: "Outlook, Calendar and To Do, with one sign-in", icon: ICON.outlook },
              { href: "/settings/accounts/icloud", label: "iCloud", sub: "Mail, Calendar and Reminders", icon: ICON.icloud },
              { href: "/settings/accounts/whatsapp", label: "WhatsApp", sub: "Scan a QR code", icon: ICON.whatsapp },
              { href: "/settings/accounts/instagram", label: "Instagram", sub: "Direct messages, Business, Creator or Personal", icon: ICON.instagram },
              { href: "/settings/accounts/linkedin", label: "LinkedIn", sub: "Messages, signed in with your LinkedIn account", icon: ICON.linkedin },
              { href: "/settings/accounts/imap", label: "Other Email", sub: "Any IMAP mailbox, like Afrihost, xneelo or cPanel", icon: ICON.imap },
            ].map((x) => (
              <SettingsRow key={x.href} href={x.href} leading={<RowIcon icon={x.icon} />} title={x.label} description={x.sub} />
            ))}
          </SettingsRows>
        </SettingsSection>

        <div className="empty:hidden"><SendAddressesSection /></div>
      </div>

      <AlertDialog open={pausing !== null} onOpenChange={(open) => { if (!open) setPausing(null); }}>
        <AlertDialogContent track="pause_sync">
          <AlertDialogHeader>
            <AlertDialogTitle>Pause Sync?</AlertDialogTitle>
            <AlertDialogDescription>
              {pausing && nameOf(pausing)} stops syncing and new messages stop arriving. Nothing is deleted, and you can reconnect it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={pause}>Pause Sync</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Account</DialogTitle>
            <DialogDescription>
              Shown next to the logo in your inbox, and only once you have more than one {renaming ? FAMILY_NAME[renaming.family] ?? renaming.accounts[0].label : "account"} connected. Leave it empty to use the default name.
            </DialogDescription>
          </DialogHeader>
          <form id="rename-account" onSubmit={(e) => { e.preventDefault(); rename(); }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={renaming ? FAMILY_NAME[renaming.family] ?? renaming.accounts[0].label : undefined} aria-label="Account Name" autoFocus />
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="secondary" type="submit" form="rename-account">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
