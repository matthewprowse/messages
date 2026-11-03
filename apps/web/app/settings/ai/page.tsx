"use client";

// Settings, AI: what the AI knows about you and how it behaves: About, Writing Style, Priorities, Behaviour (Auto Draft,
// Draft Tone, Language) and the Daily Brief. What drafts are written from, and your templates, are in Drafts.

import { Suspense } from "react";
import { useApp } from "@/lib/store";
import { SettingsPage } from "@/components/settings/settings-page";
import { AboutSection } from "@/components/settings/about-section";
import { AiBehaviourSection } from "@/components/settings/ai-behaviour";
import { BriefSection } from "@/components/settings/brief";
import { PrioritiesSection } from "@/components/settings/priorities-section";
import { WritingSection } from "@/components/settings/writing-section";

export default function AiPage() {
  const { loading } = useApp();
  return (
    <SettingsPage title="AI">
      {/* The form copies the profile when it mounts, so it remounts once the saved profile has loaded. */}
      <AboutSection key={loading ? "loading" : "loaded"} />
      <WritingSection />
      <Suspense fallback={null}>
        <PrioritiesSection />
      </Suspense>
      <AiBehaviourSection />
      <BriefSection />
    </SettingsPage>
  );
}
