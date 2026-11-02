"use client";

// Settings, Profile and Privacy: name and photo, theme, usage data, sign-out and two-factor sign-in.

import { SettingsHeader } from "@/components/settings-header";
import { ProfileSection } from "@/components/settings/profile-section";
import { AppearanceSection, PrivacySection, SignInSection } from "@/components/settings/privacy-section";
import { TwoFactorSection } from "@/components/settings/two-factor";

export default function ProfilePage() {
  return (
    <>
      <SettingsHeader title="Profile and Privacy" />
      <div className="space-y-3">
        <ProfileSection />
        <AppearanceSection />
        <PrivacySection />
        <SignInSection />
        <TwoFactorSection />
      </div>
    </>
  );
}
