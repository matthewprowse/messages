"use client";

import { SettingsHeader } from "@/components/settings-header";
import { AppearanceSection, DataSection, SignInSection } from "@/components/settings/sections";

export default function GeneralPage() {
  return (
    <>
      <SettingsHeader title="General" />
      <div className="space-y-8">
        <AppearanceSection />
        <DataSection />
        <SignInSection />
      </div>
    </>
  );
}
