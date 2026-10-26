"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { track } from "@/lib/analytics";
import { postAsUser } from "@/lib/onboarding";
import { useApp } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsHeading, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";
import { Command } from "../setup-steps";

// iCloud Reminders through Konva Relay on the user's Mac (apps/mac-relay). Upgraded Reminders lists are not on
// CalDAV, so there is no sign-in to type here: the page makes a relay token, shown once, which the Mac app is
// paired with, and says plainly what the Mac must do for it to work.

const STEPS: { title: string; body: React.ReactNode }[] = [
  { title: "Install Konva Relay", body: <><p>From the project folder, on the Mac:</p><Command>cd apps/mac-relay && make install</Command></> },
  { title: "Pair It", body: <><p>Paste the relay address and token from above when it asks:</p><Command>make setup</Command></> },
  {
    title: "Start It",
    body: <><Command>make agent</Command><p className="mt-2">It starts by itself at login from now on. Allow it to access Reminders when macOS asks.</p></>,
  },
  {
    title: "Keep the Worker Running",
    body: <><p>With RELAY_PORT=8790 in apps/worker/.env:</p><Command>pnpm worker</Command></>,
  },
];

function RelayStatus() {
  const { accounts } = useApp();
  const account = accounts.find((a) => a.provider === "icloud_reminders");
  const live = account?.status === "connected" || account?.status === "syncing";
  return (
    <SettingsSection title="Status">
      <SettingsRows>
        <SettingsRow
          title={<>Konva Relay {live ? <Badge variant="secondary">Connected</Badge>
            : account?.status === "error" ? <Badge variant="destructive">Needs Attention</Badge>
            : <Badge variant="outline" className="gap-1"><RefreshCw className="size-3 animate-spin" /> Waiting</Badge>}</>}
          description={live ? "Your reminders appear in Calendar on the day they are due." : account?.statusDetail ?? "This updates by itself once your Mac checks in."}
        />
      </SettingsRows>
    </SettingsSection>
  );
}

export default function ICloudRemindersSetup() {
  const { accounts } = useApp();
  const paired = accounts.some((a) => a.provider === "icloud_reminders");
  const [pairing, setPairing] = useState<{ token: string; relayUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { track("account_connect", { provider: "icloud_reminders", step: "setup", outcome: "start" }); }, []);

  const createToken = async () => {
    setBusy(true);
    setError(null);
    try {
      setPairing(await postAsUser<{ token: string; relayUrl: string }>("/api/connect/icloud-reminders"));
      track("account_connect", { provider: "icloud_reminders", step: "app", outcome: "done" });
    } catch (err) {
      track("account_connect", { provider: "icloud_reminders", step: "app", outcome: "failed" });
      setError(err instanceof Error ? err.message : "The relay token could not be made. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsHeader
        title="Connect iCloud Reminders"
        description="Apple keeps Reminders where other apps cannot reach them over the internet, so Konva reads them through Konva Relay, a small app on your Mac that uses Apple's own access to Reminders. Your Apple ID password is never needed."
        back="/settings/accounts"
      />
      <div className="space-y-8">
        <SettingsSection id="what-you-need" title="What You Need">
          <SettingsHeading level={3} title="A Mac That Stays On" description={<>
            <p>
              A Mac on macOS 14 or later, signed in to the same Apple ID as your iPhone, with Reminders turned on under iCloud in System
              Settings. It needs to stay on and awake; the screen can sleep. Reminders reach Konva once they reach the Mac, usually within a minute.
            </p>
          </>} />
          <SettingsHeading level={3} title="When the Mac Is Off" description={<>
            <p>Nothing syncs, and ticking a reminder off in Konva fails with a reason instead of waiting. Everything catches up when the Mac is back.</p>
          </>} />
          <SettingsHeading level={3} title="What Syncs" description={<>
            <p>
              Open reminders, and ones completed in the last 30 days, from every list: the title, notes, due date or time, priority and list.
              Ticking one off or back on in Konva does the same in Reminders, and iCloud passes it to your iPhone. Nothing else is ever changed.
            </p>
          </>} />
        </SettingsSection>

        <SettingsSection id="pair" title="Pair Your Mac" description="A relay token lets Konva Relay send your reminders to your account and nothing else.">
          {pairing ? (
            <div className="space-y-4">
              <SettingsHeading level={3} title="Relay Address" description={<Command>{pairing.relayUrl}</Command>} />
              <SettingsHeading level={3} title="Relay Token" description={<>
                <Command>{pairing.token}</Command>
                <p className="mt-2">Shown only once. Making a new token stops this one working.</p>
              </>} />
            </div>
          ) : (
            <div className="space-y-2">
              <Button onClick={createToken} disabled={busy}>{busy ? "Making a Token…" : paired ? "Replace Relay Token" : "Create Relay Token"}</Button>
              {paired && <p className="text-sm text-muted-foreground">Your Mac is already paired. A new token stops the old one working.</p>}
              {error && <FieldError>{error}</FieldError>}
            </div>
          )}
        </SettingsSection>

        <SettingsSection id="set-up" title="Set Up Konva Relay">
          <Badge variant="outline">Developer Setup</Badge>
          <ol className="space-y-6">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <SettingsHeading level={3} title={`${i + 1}. ${step.title}`} description={step.body} />
              </li>
            ))}
          </ol>
        </SettingsSection>

        {(paired || pairing) && <RelayStatus />}
      </div>
    </>
  );
}
