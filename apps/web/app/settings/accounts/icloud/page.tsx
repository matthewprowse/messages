"use client";

// One page for everything iCloud: one Apple ID sign-in connects Mail, Calendar and Reminders, and Konva makes the
// app-specific password Mail and Calendar need. Pasting a password made by hand stays for Apple IDs that cannot
// (work accounts). Reminders shows its own card once it is connected.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { SettingsBody, SettingsSection } from "@/components/settings/primitives";
import { SettingsPage } from "@/components/settings/settings-page";
import { ICloudConnectForm } from "@/components/icloud-connect";
import { ICloudSignIn } from "@/components/icloud-signin";
import { ICloudRemindersConnect } from "@/components/icloud-reminders-connect";
import { Button } from "@/components/ui/button";

export default function ICloudSetup() {
  const { session } = useAuth();
  const { accounts } = useApp();
  const [paste, setPaste] = useState(false);
  const reminders = accounts.some((a) => a.provider === "icloud_reminders");
  useEffect(() => { track("account_connect", { provider: "icloud", step: "setup", outcome: "start" }); }, []);
  return (
    <SettingsPage title="Connect iCloud" back="/settings/accounts">
      {paste ? (
        <SettingsSection id="mail-and-calendar" title="Mail and Calendar">
          <SettingsBody className="max-w-sm">
            <ICloudConnectForm
              defaultEmail={session?.user.email ?? ""}
              onConnected={({ calendar }) => toast(calendar ? "iCloud Mail and Calendar are connected." : "iCloud Mail is connected. Calendar did not accept the same sign-in.")}
            />
            <div><Button variant="ghost" onClick={() => setPaste(false)}>Sign In With Your Apple ID Instead</Button></div>
          </SettingsBody>
        </SettingsSection>
      ) : (
        <SettingsSection id="sign-in" title="Sign In With Your Apple ID">
          <SettingsBody className="max-w-sm">
            <ICloudSignIn
              defaultEmail={session?.user.email ?? ""}
              onConnected={({ message }) => toast(message)}
              onUsePassword={() => setPaste(true)}
            />
          </SettingsBody>
        </SettingsSection>
      )}
      {(reminders || paste) && (
        <SettingsSection id="reminders" title="Reminders">
          <SettingsBody><ICloudRemindersConnect /></SettingsBody>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
