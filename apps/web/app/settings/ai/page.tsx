"use client";

// Settings, AI: everything the AI knows or does for you, in one place: what drafts use, About, Writing Style,
// Priorities, Auto-Draft, Language and the Daily Brief.

import { Suspense } from "react";
import { useApp } from "@/lib/store";
import { SettingsHeader } from "@/components/settings-header";
import { AboutSection } from "@/components/settings/about-section";
import { AiBehaviourSection } from "@/components/settings/ai-behaviour";
import { BriefSection } from "@/components/settings/brief";
import { DraftsUseSection } from "@/components/settings/drafts-use";
import { PrioritiesSection } from "@/components/settings/priorities-section";
import { WritingSection } from "@/components/settings/writing-section";

export default function AiPage() {
  const { loading } = useApp();
  return (
    <>
      <SettingsHeader title="AI" description="What the AI knows about you, how it writes for you, what it treats as important and when it does things for you." />
      <div className="space-y-3">
        <DraftsUseSection />
        {/* The form copies the profile when it mounts, so it remounts once the saved profile has loaded. */}
        <AboutSection key={loading ? "loading" : "loaded"} />
        <WritingSection />
        <Suspense fallback={null}>
          <PrioritiesSection />
        </Suspense>
        <AiBehaviourSection />
        <BriefSection />
      </div>
    </>
  );
}
