"use client";

// Settings, General: profile photo, appearance, language, data, setup, sign-in and two-factor sections.

import { SettingsHeader } from "@/components/settings-header";
import { AppearanceSection, ProfilePhotoSection, DataSection, LanguageSection, SignInSection, RunSetupSection } from "@/components/settings/sections";
import { TwoFactorSection } from "@/components/settings/two-factor";

export default function GeneralPage() {
  return (
    <>
      <SettingsHeader title="General" />
      <div className="space-y-3">
        <ProfilePhotoSection />
        <AppearanceSection />
        <LanguageSection />
        <DataSection />
        <RunSetupSection />
        <SignInSection />
        <TwoFactorSection />
      </div>
    </>
  );
}
