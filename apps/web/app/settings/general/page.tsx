"use client";

// Settings, General: appearance, language, data, tour and sign-in sections.

import { SettingsHeader } from "@/components/settings-header";
import { AppearanceSection, ProfilePhotoSection, DataSection, LanguageSection, SignInSection, TourSection } from "@/components/settings/sections";
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
        <TourSection />
        <SignInSection />
        <TwoFactorSection />
      </div>
    </>
  );
}
