"use client";

// Shared pieces of the connect pages under settings/accounts: SetupSteps (header, in-app connect slot, numbered terminal steps),
// a copyable Command, and the status line that waits for the worker to pick the account up.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { useApp } from "@/lib/store";
import type { Account, Provider } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsHeading, SettingsRow, SettingsRows } from "@/components/settings/sections";

export type SetupStep = { title: string; body: React.ReactNode };

/** A terminal command shown in a setup step, with a button to copy it. */
export function Command({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Could not copy. Select the command and copy it instead.");
    }
  };
  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded-lg bg-muted py-2 pr-12 pl-3 font-mono text-xs text-foreground">{children}</pre>
      <Button variant="ghost" size="icon" className="absolute top-1 right-1" aria-label={copied ? "Copied" : "Copy Command"} onClick={copy}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

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

/**
 * Connecting a provider, counted once when the page opens: `connect` does it in the app when there is a way,
 * and the numbered steps do it from the terminal, below it as the developer route.
 */
export function SetupSteps({ provider, title, description, steps, label, watch, connect }: { provider: string; title: string; description: string; steps: SetupStep[]; label: string; watch: Provider[]; connect?: React.ReactNode }) {
  useEffect(() => { track("account_connect", { provider, step: "setup", outcome: "start" }); }, [provider]);
  return (
    <>
      <SettingsHeader title={title} description={description} back="/settings/accounts" />
      {connect && <div className="mb-3">{connect}</div>}
      <Badge variant="outline" className="mb-4">{connect ? "Developer Setup From the Terminal" : "Developer Setup"}</Badge>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.title}>
            <SettingsHeading title={`${i + 1}. ${step.title}`} description={step.body} />
          </li>
        ))}
      </ol>
      <ConnectionStatus label={label} providers={watch} />
    </>
  );
}
