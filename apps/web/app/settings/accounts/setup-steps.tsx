"use client";

// Shared pieces of the connect pages under settings/accounts: SetupSteps (the page, the in-app connect card) and the Status
// card that waits for the worker to pick the account up. People connect in the web page only; the developer's one-time
// provider setup lives in docs/CONNECTOR-SETUP.md, not here.

import { useEffect } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics";
import { useApp } from "@/lib/store";
import type { Account, Provider } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccountStatusBadge } from "@/components/settings/connect-family";
import { SettingsBody, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { SettingsPage } from "@/components/settings/settings-page";

/** Waiting until the worker has the account, then Connected with a way on to the Inbox. */
function ConnectionStatus({ label, providers }: { label: string; providers: Provider[] }) {
  const { accounts } = useApp();
  const found = accounts.filter((a) => providers.includes(a.provider));
  const live = found.some((a: Account) => a.status === "connected" || a.status === "syncing");
  const connecting = !live && found.some((a) => a.status === "connecting");
  return (
    <SettingsSection id="status" title="Status">
      <div aria-live="polite">
        <SettingsRows>
          <SettingsRow title={<>{label} {live ? <AccountStatusBadge status="connected" /> : connecting ? <AccountStatusBadge status="connecting" /> : <Badge variant="outline">Waiting</Badge>}</>}>
            {live && <Button variant="secondary" asChild><Link href="/inbox">Go to Inbox</Link></Button>}
          </SettingsRow>
        </SettingsRows>
      </div>
    </SettingsSection>
  );
}

/** Connecting a provider, counted once when the page opens: `connect` does it in the app, then the status waits for the worker. */
export function SetupSteps({ provider, title, label, watch, connect }: { provider: string; title: string; label: string; watch: Provider[]; connect: React.ReactNode }) {
  useEffect(() => { track("account_connect", { provider, step: "setup", outcome: "start" }); }, [provider]);
  return (
    <SettingsPage title={title} back="/settings/accounts">
      <SettingsSection id="connect" title="Sign In"><SettingsBody>{connect}</SettingsBody></SettingsSection>
      <ConnectionStatus label={label} providers={watch} />
    </SettingsPage>
  );
}
