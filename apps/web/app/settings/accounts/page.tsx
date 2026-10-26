"use client";

import Link from "next/link";
import { useState } from "react";
import { Mail, Calendar, ListChecks, MessageCircle, RefreshCw, Video } from "lucide-react";
import { useApp } from "@/lib/store";
import { relTime } from "@/lib/format";
import type { Account } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const { accounts, dispatch, notify } = useApp();
  const [pausing, setPausing] = useState<Account | null>(null);
  const pause = () => {
    if (!pausing) return;
    dispatch({ type: "patchAccount", id: pausing.id, patch: { status: "disconnected" } });
    notify(`Sync paused for ${pausing.label}`);
    setPausing(null);
  };
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
        {accounts.length === 0 ? <SettingsEmpty>No accounts connected yet.</SettingsEmpty> : (
          <SettingsRows>
            {accounts.map((a) => (
              <SettingsRow
                key={a.id}
                leading={<RowIcon icon={ICON[a.provider]} />}
                title={<>{a.label} <StatusBadge status={a.status} /></>}
                description={
                  <>
                    <span className="block truncate">{a.detail}{a.lastSync && a.status === "connected" ? ` · Last synced ${relTime(a.lastSync)}` : ""}</span>
                    {a.statusDetail && a.status !== "connected" && <span className="block">{a.statusDetail}</span>}
                  </>
                }
              >
                {a.status === "disconnected" || a.status === "error" ? (
                  <Button size="sm" asChild><Link href={SETUP[a.provider]}>Reconnect</Link></Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setPausing(a)}>Pause Sync</Button>
                )}
              </SettingsRow>
            ))}
          </SettingsRows>
        )}

        <SettingsSection id="add-account" title="Add an Account">
          <SettingsRows>
            {[
              { href: "/settings/accounts/icloud", label: "iCloud+ Mail", sub: "Mail on your own domain", icon: ICON.icloud },
              { href: "/settings/accounts/icloud-calendar", label: "iCloud Calendar", sub: "Your iCloud events", icon: ICON.icloud_calendar },
              { href: "/settings/accounts/icloud-reminders", label: "iCloud Reminders", sub: "Through a small app on your Mac", icon: ICON.icloud_reminders },
              { href: "/settings/accounts/google", label: "Google", sub: "Gmail and Calendar", icon: ICON.gmail },
              { href: "/settings/accounts/microsoft", label: "Microsoft", sub: "Outlook and Calendar, work or personal", icon: ICON.outlook },
              { href: "/settings/accounts/whatsapp", label: "WhatsApp", sub: "Scan a QR code", icon: ICON.whatsapp },
              { href: "/settings/accounts/imap", label: "Other Email", sub: "Any IMAP mailbox, like Afrihost, xneelo or cPanel", icon: ICON.imap },
              { href: "/settings/accounts/zoom", label: "Zoom", sub: "Meeting transcripts and Team Chat", icon: ICON.zoom },
              { href: "/settings/accounts/linkedin", label: "LinkedIn", sub: "Messages, with your browser's cookies", icon: ICON.linkedin },
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
              {pausing?.label} stops syncing and new messages stop arriving. Nothing is deleted, and you can reconnect it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={pause}>Pause Sync</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
