"use client";

import { SettingsHeader } from "@/components/settings-header";
import { AppearanceSection, DataSection, LanguageSection, SignInSection, TourSection } from "@/components/settings/sections";

export default function GeneralPage() {
  return (
    <>
      <SettingsHeader title="General" />
      <div className="space-y-8">
        <AppearanceSection />
        <LanguageSection />
        <DataSection />
        <TourSection />
        <SignInSection />
      </div>
    </>
  );
}
