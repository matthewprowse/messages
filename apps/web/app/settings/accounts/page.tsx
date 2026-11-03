"use client";

// Settings, Accounts: each sign-in with Pause or Resume, Reconnect and Rename, the ways to add one, and Sending: Undo Send,
// WhatsApp read receipts, the addresses each mailbox sends from and their signatures.

import Link from "next/link";
import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useApp } from "@/lib/store";
import { relTime } from "@/lib/format";
import { attentionFirst, groupAccounts, groupProblem, groupStatus, partsOf, setupHrefOf, summariseGroups, type AccountGroup } from "@/lib/account-groups";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { IconCircle, Row } from "@/components/surface";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsBody, SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { AccountStatusBadge } from "@/components/settings/connect-family";
import { PauseDialog, RenameDialog, groupName } from "@/components/settings/account-dialogs";
import { ReadReceiptsRow } from "@/components/settings/read-receipts-section";
import { UndoSendRow } from "@/components/settings/undo-send-section";
import { SendAddressesSection } from "@/components/settings/send-addresses";
import { SignaturesSection } from "@/components/settings/signatures-section";
import { ADD_ACCOUNTS, PROVIDER_ICON } from "./providers";

export default function AccountsPage() {
  const { accounts, loading, dispatch, notify } = useApp();
  const [pausing, setPausing] = useState<AccountGroup | null>(null);
  const [renaming, setRenaming] = useState<AccountGroup | null>(null);
  const groups = attentionFirst(groupAccounts(accounts));
  const summary = summariseGroups(groups);
  const hasWhatsApp = accounts.some((a) => a.provider === "whatsapp");

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
    <SettingsPage title="Accounts">
      {summary.attention > 0 && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{summary.attention === 1 ? "1 Account Needs Attention" : `${summary.attention} Accounts Need Attention`}</AlertTitle>
        </Alert>
      )}
      <SettingsSection id="connected" title="Connected" action={groups.length > 0 && <span className="text-sm tabular-nums text-muted-foreground">{summary.working} of {summary.total} Working</span>}>
        {groups.length === 0 ? (loading ? <SettingsBody><Skeleton className="h-24 w-full rounded-lg" /></SettingsBody> : <SettingsEmpty>No accounts connected yet.</SettingsEmpty>) : (
          <SettingsRows inset="lead">
            {groups.map((g) => {
              const status = groupStatus(g);
              const problem = groupProblem(g);
              const first = g.accounts[0];
              return (
                <SettingsRow
                  key={g.key}
                  leading={<IconCircle icon={PROVIDER_ICON[first.provider]} />}
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
        )}
      </SettingsSection>

      <SettingsSection id="add-account" title="Add an Account">
        <SettingsRows inset="lead">
          {ADD_ACCOUNTS.map((x) => <Row key={x.href} href={x.href} lead={<IconCircle icon={PROVIDER_ICON[x.provider]} />} title={x.label} />)}
        </SettingsRows>
      </SettingsSection>

      <SettingsSection id="sending" title="Sending">
        <SettingsRows>
          <UndoSendRow />
          {hasWhatsApp && <ReadReceiptsRow />}
        </SettingsRows>
        <SendAddressesSection />
        <SignaturesSection />
      </SettingsSection>

      <PauseDialog group={pausing} onClose={() => setPausing(null)} onPause={pause} />
      <RenameDialog group={renaming} onClose={() => setRenaming(null)} onSave={rename} />
    </SettingsPage>
  );
}
