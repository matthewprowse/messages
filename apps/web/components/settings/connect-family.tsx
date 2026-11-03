"use client";

// The pieces the Google and Microsoft connect pages share: the sign-in form (an optional extra checkbox, the connect button
// and the outcome text) and the per-part Status card. The sign-in redirects themselves stay in each page.

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useApp } from "@/lib/store";
import type { Account, Provider } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

/** One status for every list of accounts: the same words and look on the Accounts page and the connect pages. */
export function AccountStatusBadge({ status }: { status: Account["status"] }) {
  if (status === "connected") return <Badge variant="secondary">Connected</Badge>;
  if (status === "syncing") return <Badge variant="outline" className="gap-1"><RefreshCw className="size-3 animate-spin" /> Syncing</Badge>;
  if (status === "connecting") return <Badge variant="outline" className="gap-1"><RefreshCw className="size-3 animate-spin" /> Connecting</Badge>;
  if (status === "error") return <Badge variant="destructive">Needs Attention</Badge>;
  return <Badge variant="outline">Sync Paused</Badge>;
}

/** The sign-in form: an optional extra (Meet and Chat, Teams), the button and what happened. `children` follow the button. */
export function ConnectForm({ optionId, optionLabel, checked, onChecked, busy, onStart, logo, buttonLabel, error, notice, children }: {
  optionId: string; optionLabel: string; checked: boolean; onChecked: (on: boolean) => void;
  busy: boolean; onStart: () => void; logo: React.ReactNode; buttonLabel: string; error: string | null; notice: string | null; children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <Field orientation="horizontal">
        <Checkbox id={optionId} checked={checked} disabled={busy} onCheckedChange={(on) => onChecked(on === true)} />
        <FieldLabel htmlFor={optionId}>{optionLabel}</FieldLabel>
      </Field>
      <div className="space-y-2">
        <div><Button variant="secondary" disabled={busy} onClick={onStart}>{logo} {buttonLabel}</Button></div>
        {error && <FieldError>{error}</FieldError>}
        {notice && <FieldDescription>{notice}</FieldDescription>}
      </div>
      {children}
    </div>
  );
}

export interface Part { provider: Provider; label: string }

/** The Status card: each part of a sign-in as the worker reports it, with what went wrong when it did. A part that is not there shows as Not Connected. */
export function PartsStatus({ parts, goToInbox }: { parts: Part[]; goToInbox?: Provider }) {
  const { accounts } = useApp();
  return (
    <SettingsSection id="status" title="Status">
      <div aria-live="polite">
        <SettingsRows>
          {parts.map((part) => {
            const found = accounts.filter((a) => a.provider === part.provider);
            const live = found.some((a) => a.status === "connected" || a.status === "syncing");
            const problem = !live && found.some((a) => a.status === "error");
            const first = found.find((a) => a.statusDetail);
            return (
              <SettingsRow
                key={part.provider}
                title={<>{part.label} {found.length === 0 ? <Badge variant="outline">Not Connected</Badge> : <AccountStatusBadge status={live ? "connected" : problem ? "error" : "connecting"} />}</>}
                description={problem ? first?.statusDetail : undefined}
              >
                {live && part.provider === goToInbox && <Button variant="secondary" asChild><Link href="/inbox">Go to Inbox</Link></Button>}
              </SettingsRow>
            );
          })}
        </SettingsRows>
      </div>
    </SettingsSection>
  );
}
