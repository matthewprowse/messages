"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { useAuth } from "@/lib/auth";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsSection } from "@/components/settings/sections";
import { ICloudConnectForm } from "@/components/icloud-connect";
import { ICloudRemindersConnect } from "@/components/icloud-reminders-connect";

// One page for everything iCloud: Mail and Calendar share an app-specific password, and Reminders is the one
// part Apple only opens to a full Apple ID sign-in, so it is the second form here, not a separate setup.
export default function ICloudSetup() {
  const { session } = useAuth();
  useEffect(() => { track("account_connect", { provider: "icloud", step: "setup", outcome: "start" }); }, []);
  return (
    <>
      <SettingsHeader
        title="Connect iCloud"
        description="iCloud Mail, Calendar and Reminders, each connected from this page. Nothing is installed."
        back="/settings/accounts"
      />
      <div className="max-w-sm space-y-10">
        <SettingsSection
          id="mail-and-calendar"
          title="Mail and Calendar"
          description="Create an app-specific password at account.apple.com, under Sign-In and Security, and paste it here. It is four groups of four letters, and it is checked with iCloud and stored encrypted."
        >
          <ICloudConnectForm
            defaultEmail={session?.user.email ?? ""}
            onConnected={({ calendar }) => toast(calendar ? "iCloud Mail and Calendar are connected." : "iCloud Mail is connected. Calendar did not accept the same sign-in.")}
          />
        </SettingsSection>
        <SettingsSection
          id="reminders"
          title="Reminders"
          description="Apple opens Reminders only to your Apple ID and password, so they are asked for here. The password is used once to sign in and is not kept."
        >
          <ICloudRemindersConnect />
        </SettingsSection>
      </div>
    </>
  );
}
