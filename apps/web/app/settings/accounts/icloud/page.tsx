"use client";

import { SettingsHeader } from "@/components/settings-header";
import { SettingsHeading } from "@/components/settings/sections";

export default function ICloudSetup() {
  return (
    <>
      <SettingsHeader title="Connect iCloud+ Mail" description="iCloud is connected from your terminal, so the app-specific password is typed only there, checked with iCloud, and stored encrypted." back="/settings/accounts" />
      <ol className="space-y-6">
        <li>
          <SettingsHeading title="1. Create an App-Specific Password" description="At account.apple.com, under Sign-In and Security. It is four groups of four letters." />
        </li>
        <li>
          <SettingsHeading
            title="2. Run the Connect Command"
            description={<><p>From the project folder:</p><pre className="mt-2 rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">pnpm connect:icloud</pre></>}
          />
        </li>
        <li>
          <SettingsHeading
            title="3. Keep the Worker Running"
            description={<><pre className="mt-2 rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">pnpm worker</pre><p className="mt-2">New mail then appears in Conversations within seconds.</p></>}
          />
        </li>
      </ol>
    </>
  );
}
