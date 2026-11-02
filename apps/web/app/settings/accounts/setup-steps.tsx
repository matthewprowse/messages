"use client";

// Shared pieces of the connect pages under settings/accounts: SetupSteps (header, the in-app connect slot) and the status
// line that waits for the worker to pick the account up. People connect in the web page only; the developer's one-time
// provider setup lives in docs/CONNECTOR-SETUP.md, not here.

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { track } from "@/lib/analytics";
import { useApp } from "@/lib/store";
import type { Account, Provider } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsHeading, SettingsRow, SettingsRows } from "@/components/settings/sections";

/** Waiting until the worker has the account, then Connected with a way on to the Inbox. */
function ConnectionStatus({ label, providers }: { label: string; providers: Provider[] }) {
  const { accounts } = useApp();
  const found = accounts.filter((a) => providers.includes(a.provider));
  const live = found.some((a: Account) => a.status === "connected" || a.status === "syncing");
  const connecting = !live && found.some((a) => a.status === "connecting");
  return (
    <section className="mt-3 space-y-3" aria-live="polite">
      <SettingsHeading title="Status" />
      <SettingsRows>
        <SettingsRow
          title={<>{label} {live ? <Badge variant="secondary">Connected</Badge> : <Badge variant="outline" className="gap-1"><RefreshCw className="size-3 animate-spin" /> {connecting ? "Connecting" : "Waiting"}</Badge>}</>}
          description={live ? "New messages appear in the Inbox within seconds." : "This updates by itself once the worker has connected the account."}
        >
          {live && <Button variant="secondary" asChild><Link href="/inbox">Go to Inbox</Link></Button>}
        </SettingsRow>
      </SettingsRows>
    </section>
  );
}

/** Connecting a provider, counted once when the page opens: `connect` does it in the app, then the status waits for the worker. */
export function SetupSteps({ provider, title, description, label, watch, connect }: { provider: string; title: string; description: string; label: string; watch: Provider[]; connect: React.ReactNode }) {
  useEffect(() => { track("account_connect", { provider, step: "setup", outcome: "start" }); }, [provider]);
  return (
    <>
      <SettingsHeader title={title} description={description} back="/settings/accounts" />
      <div className="mb-3">{connect}</div>
      <ConnectionStatus label={label} providers={watch} />
    </>
  );
}
