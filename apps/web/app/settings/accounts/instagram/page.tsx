"use client";

// Settings page for connecting Instagram. The form and sign-in steps are in InstagramSetup, drawn in one card; its own groups
// (account type, Before You Connect) sit inside that card. Records a setup start.

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { SettingsBody, SettingsSection } from "@/components/settings/primitives";
import { SettingsPage } from "@/components/settings/settings-page";
import { InstagramSetup } from "@/components/instagram-setup";

export default function InstagramPage() {
  useEffect(() => { track("account_connect", { provider: "instagram", step: "setup", outcome: "start" }); }, []);
  return (
    <SettingsPage title="Connect Instagram" back="/settings/accounts">
      <SettingsSection id="connect" title="Sign In">
        <SettingsBody><InstagramSetup /></SettingsBody>
      </SettingsSection>
    </SettingsPage>
  );
}
