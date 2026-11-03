"use client";

// Settings, Profile: name and photo, theme, who is signed in, two factor sign in and the sessions signed in.

import { SettingsPage } from "@/components/settings/settings-page";
import { ProfileSection } from "@/components/settings/profile-section";
import { AppearanceSection, SignInSection } from "@/components/settings/privacy-section";
import { TwoFactorSection } from "@/components/settings/two-factor";
import { SessionsSection } from "@/components/settings/privacy/sessions";

export default function ProfilePage() {
  return (
    <SettingsPage title="Profile">
      <ProfileSection />
      <AppearanceSection />
      <SignInSection />
      <TwoFactorSection />
      <SessionsSection />
    </SettingsPage>
  );
}
