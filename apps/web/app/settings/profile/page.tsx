"use client";

// Settings, Profile and Privacy: name and photo, theme, usage data, sign-out and two-factor sign-in, then the POPIA controls:
// Download My Data, active sessions, Disconnect or Remove an account, and Delete My Account.

import { SettingsHeader } from "@/components/settings-header";
import { ProfileSection } from "@/components/settings/profile-section";
import { AppearanceSection, PrivacySection, SignInSection } from "@/components/settings/privacy-section";
import { TwoFactorSection } from "@/components/settings/two-factor";
import { DownloadDataSection } from "@/components/settings/privacy/download-data";
import { SessionsSection } from "@/components/settings/privacy/sessions";
import { ConnectedAccountsSection } from "@/components/settings/privacy/account-removal";
import { DeleteMyAccountSection } from "@/components/settings/privacy/delete-my-account";

export default function ProfilePage() {
  return (
    <>
      <SettingsHeader title="Profile and Privacy" />
      <div className="space-y-3">
        <ProfileSection />
        <AppearanceSection />
        <PrivacySection />
        <DownloadDataSection />
        <SignInSection />
        <TwoFactorSection />
        <SessionsSection />
        <ConnectedAccountsSection />
        <DeleteMyAccountSection />
      </div>
    </>
  );
}
