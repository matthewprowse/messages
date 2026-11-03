"use client";

// Settings, Updates: the owner's changelog editor (components/updates). Anyone else is shown nothing here, and the database
// refuses them anyway; the list in Settings hides this row from them.

import { useIsOwner } from "@/lib/auth";
import { SettingsEmpty, SettingsSection } from "@/components/settings/primitives";
import { SettingsPage } from "@/components/settings/settings-page";
import { UpdatesPanel } from "@/components/updates/updates-panel";

export default function UpdatesPage() {
  const isOwner = useIsOwner();
  return (
    <SettingsPage title="Updates">
      {isOwner ? <UpdatesPanel /> : <SettingsSection title="Updates"><SettingsEmpty>Only the owner can see this.</SettingsEmpty></SettingsSection>}
    </SettingsPage>
  );
}
