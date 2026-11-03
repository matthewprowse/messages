"use client";

// Settings, Drafts: your templates and snippets, then what every draft is written from and what the AI has learned from
// your mail (style rules, how you write to people, companies).

import { SettingsPage } from "@/components/settings/settings-page";
import { DraftsUseSection } from "@/components/settings/drafts-use";
import { TemplatesSection } from "@/components/settings/templates-section";

export default function DraftsPage() {
  return (
    <SettingsPage title="Drafts">
      <TemplatesSection />
      <DraftsUseSection />
    </SettingsPage>
  );
}
