"use client";

import Link from "next/link";
import { Mail, Calendar, MessageCircle, Plus, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/store";
import { relTime } from "@/lib/format";
import type { Account } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";
import { SendAddressesSection } from "@/components/settings/send-addresses";

const ICON = { icloud: Mail, gmail: Mail, google_calendar: Calendar, whatsapp: MessageCircle } as const;
const SETUP = { icloud: "/settings/accounts/icloud", gmail: "/settings/accounts/google", google_calendar: "/settings/accounts/google", whatsapp: "/settings/accounts/whatsapp" } as const;

function StatusBadge({ status }: { status: Account["status"] }) {
  if (status === "connected") return <Badge variant="secondary">Connected</Badge>;
  if (status === "syncing") return <Badge variant="outline" className="gap-1"><RefreshCw className="size-3 animate-spin" /> Syncing</Badge>;
  if (status === "connecting") return <Badge variant="outline" className="gap-1"><RefreshCw className="size-3 animate-spin" /> Connecting</Badge>;
  if (status === "error") return <Badge variant="destructive">Needs Attention</Badge>;
  return <Badge variant="outline">Disconnected</Badge>;
}

function RowIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><Icon className="size-4" /></div>;
}

export default function AccountsPage() {
  const { accounts, dispatch, notify } = useApp();
  return (
    <>
      <SettingsHeader title="Connected Accounts" description="Messages are read over IMAP, the Gmail API and a linked WhatsApp device. Nothing is ever sent without you." />
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
                  <Button variant="outline" size="sm" onClick={() => { dispatch({ type: "patchAccount", id: a.id, patch: { status: "disconnected" } }); notify(`${a.label} disconnected`); }}>Disconnect</Button>
                )}
              </SettingsRow>
            ))}
          </SettingsRows>
        )}

        <SettingsSection id="add-account" title="Add an Account">
          <SettingsRows>
            {[
              { href: "/settings/accounts/icloud", label: "iCloud+ Mail", sub: "Custom domain, IMAP and SMTP" },
              { href: "/settings/accounts/google", label: "Google", sub: "Gmail and Calendar" },
              { href: "/settings/accounts/whatsapp", label: "WhatsApp", sub: "Scan a QR code" },
            ].map((x) => (
              <SettingsRow key={x.href} href={x.href} leading={<RowIcon icon={Plus} />} title={x.label} description={x.sub} />
            ))}
          </SettingsRows>
        </SettingsSection>

        <div className="empty:hidden"><SendAddressesSection /></div>
      </div>
    </>
  );
}
