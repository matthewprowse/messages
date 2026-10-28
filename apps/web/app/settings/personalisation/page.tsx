"use client";

// Settings, Personalisation: how drafts use your details, the About and Writing profile, and priorities.

import { Suspense } from "react";
import { useApp } from "@/lib/store";
import { SettingsHeader } from "@/components/settings-header";
import { AboutSection, PrioritiesSection, WritingSection } from "@/components/settings/sections";
import { DraftsUseSection } from "@/components/settings/drafts-use";

export default function PersonalisationPage() {
  const { loading } = useApp();
  return (
    <>
      <SettingsHeader title="Personalisation" description="What the AI knows about you, how it writes for you, and what it treats as important." />
      <div className="space-y-3">
        <DraftsUseSection />
        {/* The form copies the profile when it mounts, so it remounts once the saved profile has loaded. */}
        <AboutSection key={loading ? "loading" : "loaded"} />
        <WritingSection />
        <Suspense fallback={null}>
          <PrioritiesSection />
        </Suspense>
      </div>
    </>
  );
}
