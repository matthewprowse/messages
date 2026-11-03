"use client";

// Settings, Privacy and Data: the usage data switch, then the POPIA controls: Download My Data, Disconnect or Remove an
// account, and Delete My Account. Download sits above the deletions on purpose.

import { SettingsPage } from "@/components/settings/settings-page";
import { PrivacySection } from "@/components/settings/privacy-section";
import { DownloadDataSection } from "@/components/settings/privacy/download-data";
import { ConnectedAccountsSection } from "@/components/settings/privacy/account-removal";
import { DeleteMyAccountSection } from "@/components/settings/privacy/delete-my-account";

export default function PrivacyPage() {
  return (
    <SettingsPage title="Privacy and Data">
      <PrivacySection />
      <DownloadDataSection />
      <ConnectedAccountsSection />
      <DeleteMyAccountSection />
    </SettingsPage>
  );
}
