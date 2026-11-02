"use client";

// One page for everything iCloud: one Apple ID sign-in connects Mail, Calendar and Reminders, and Konva makes the
// app-specific password Mail and Calendar need. Pasting a password made by hand stays for Apple IDs that cannot
// (work accounts). Reminders shows its own status below once it is connected.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsSection } from "@/components/settings/primitives";
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
    <>
      <SettingsHeader
        title="Connect iCloud"
        description="Mail, Calendar and Reminders with one Apple ID sign-in. Nothing is installed."
        back="/settings/accounts"
      />
      <div className="max-w-sm space-y-10">
        {paste ? (
          <SettingsSection
            id="mail-and-calendar"
            title="Mail and Calendar"
            description="Create an app-specific password at account.apple.com, under Sign-In and Security, and paste it here. It is four groups of four letters, and it is checked with iCloud and stored encrypted."
          >
            <div className="space-y-4">
              <ICloudConnectForm
                defaultEmail={session?.user.email ?? ""}
                onConnected={({ calendar }) => toast(calendar ? "iCloud Mail and Calendar are connected." : "iCloud Mail is connected. Calendar did not accept the same sign-in.")}
              />
              <Button variant="ghost" onClick={() => setPaste(false)}>Sign In With Your Apple ID Instead</Button>
            </div>
          </SettingsSection>
        ) : (
          <SettingsSection
            id="sign-in"
            title="Sign In With Your Apple ID"
            description="Choose what to connect. Apple asks for a code from one of your devices."
          >
            <ICloudSignIn
              defaultEmail={session?.user.email ?? ""}
              onConnected={({ message }) => toast(message)}
              onUsePassword={() => setPaste(true)}
            />
          </SettingsSection>
        )}
        {(reminders || paste) && (
          <SettingsSection
            id="reminders"
            title="Reminders"
            description="Apple opens Reminders only to your Apple ID and password. The password is used once to sign in and is not kept."
          >
            <ICloudRemindersConnect />
          </SettingsSection>
        )}
      </div>
    </>
  );
}
