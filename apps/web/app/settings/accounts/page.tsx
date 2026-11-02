"use client";

// Settings, Accounts: how many accounts are working, then each sign-in with Pause or Resume, Reconnect and Rename; the
// ways to add one; WhatsApp read receipts; and send addresses.

import Link from "next/link";
import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useApp } from "@/lib/store";
import { relTime } from "@/lib/format";
import { attentionFirst, groupAccounts, groupProblem, groupStatus, partsOf, setupHrefOf, summariseGroups, type AccountGroup } from "@/lib/account-groups";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { AccountStatusBadge } from "@/components/settings/connect-family";
import { PauseDialog, RenameDialog, groupName } from "@/components/settings/account-dialogs";
import { ReadReceiptsSection } from "@/components/settings/read-receipts-section";
import { SendAddressesSection } from "@/components/settings/send-addresses";
import { ADD_ACCOUNTS, PROVIDER_ICON } from "./providers";

function RowIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><Icon className="size-4" /></div>;
}

export default function AccountsPage() {
  const { accounts, loading, dispatch, notify } = useApp();
  const [pausing, setPausing] = useState<AccountGroup | null>(null);
  const [renaming, setRenaming] = useState<AccountGroup | null>(null);
  const groups = attentionFirst(groupAccounts(accounts));
  const summary = summariseGroups(groups);

  const rename = (g: AccountGroup, name: string) => {
    for (const a of g.accounts) dispatch({ type: "patchAccount", id: a.id, patch: { nickname: name } });
    setRenaming(null);
  };
  const pause = (g: AccountGroup) => {
    for (const a of g.accounts) dispatch({ type: "patchAccount", id: a.id, patch: { status: "disconnected" } });
    notify(`Sync paused for ${groupName(g)}`);
    setPausing(null);
  };
  // No sign-in needed: the stored credentials are still there, and "connecting" is what the sync worker restarts on.
  const resume = (g: AccountGroup) => {
    for (const a of g.accounts) dispatch({ type: "patchAccount", id: a.id, patch: { status: "connecting" } });
    notify(`Resuming ${groupName(g)}`);
  };

  return (
    <>
      <SettingsHeader
        title="Accounts"
        description={<p>Your email, calendars and WhatsApp in one place. Nothing is ever sent without you.</p>}
      />
      <div className="space-y-3">
        {summary.attention > 0 && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{summary.attention === 1 ? "1 Account Needs Attention" : `${summary.attention} Accounts Need Attention`}</AlertTitle>
            <AlertDescription>Reconnect {summary.attention === 1 ? "it" : "them"} below so new messages keep arriving.</AlertDescription>
          </Alert>
        )}
        {groups.length === 0 ? (loading ? <Skeleton className="h-40 w-full rounded-lg" /> : <SettingsEmpty>No accounts connected yet. Add one below.</SettingsEmpty>) : (
          <SettingsSection id="connected" title="Connected" description={`${summary.working} of ${summary.total} ${summary.total === 1 ? "account" : "accounts"} working.`}>
            <SettingsRows>
              {groups.map((g) => {
                const status = groupStatus(g);
                const problem = groupProblem(g);
                const first = g.accounts[0];
                return (
                  <SettingsRow
                    key={g.key}
                    leading={<RowIcon icon={PROVIDER_ICON[first.provider]} />}
                    title={<>{groupName(g)} <AccountStatusBadge status={status} /></>}
                    description={
                      <>
                        <span className="block truncate">{[g.accounts.length > 1 ? partsOf(g) : "", g.accounts.map((a) => a.detail).find((d) => d && !d.startsWith("urn:"))].filter(Boolean).join(" · ")}{first.lastSync && status === "connected" ? ` · Last synced ${relTime(first.lastSync)}` : ""}</span>
                        {problem && status !== "connected" && <span className="block">{problem}</span>}
                      </>
                    }
                  >
                    <Button variant="ghost" onClick={() => setRenaming(g)}>Rename</Button>
                    {status === "error" ? (
                      <Button variant="secondary" asChild><Link href={setupHrefOf(g)}>Reconnect</Link></Button>
                    ) : status === "disconnected" ? (
                      <Button variant="secondary" onClick={() => resume(g)}>Resume Sync</Button>
                    ) : (
                      <Button variant="secondary" onClick={() => setPausing(g)}>Pause Sync</Button>
                    )}
                  </SettingsRow>
                );
              })}
            </SettingsRows>
          </SettingsSection>
        )}

        <ReadReceiptsSection />

        <SettingsSection id="add-account" title="Add an Account">
          <SettingsRows>
            {ADD_ACCOUNTS.map((x) => (
              <SettingsRow key={x.href} href={x.href} leading={<RowIcon icon={PROVIDER_ICON[x.provider]} />} title={x.label} description={x.sub} />
            ))}
          </SettingsRows>
        </SettingsSection>

        <div className="empty:hidden"><SendAddressesSection /></div>
      </div>

      <PauseDialog group={pausing} onClose={() => setPausing(null)} onPause={pause} />
      <RenameDialog group={renaming} onClose={() => setRenaming(null)} onSave={rename} />
    </>
  );
}
