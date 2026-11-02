"use client";

// Settings, Team, Company Voice: how the business writes, its templates and company facts. Everyone on the team reads it,
// an owner or admin edits it, and the AI uses it only for drafts in a work chat.

import { useTeam } from "@/lib/team";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsEmpty } from "@/components/settings/primitives";
import { CompanyVoiceSections } from "@/components/settings/team-voice";

export default function CompanyVoicePage() {
  const { state } = useTeam();
  const manages = state?.role === "owner" || state?.role === "admin";
  return (
    <>
      <SettingsHeader
        title="Company Voice"
        description={state?.workspace ? `${state.workspace.name}. ${manages ? "The AI and your team use this in work chats. It is never used in a personal chat." : "What the AI and your team use in work chats. Only an owner or admin can change it."}` : "How the business writes."}
        back="/settings/team"
      />
      <div className="space-y-3">
        {!state ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : !state.workspace ? (
          <SettingsEmpty>Join a team to see its company voice.</SettingsEmpty>
        ) : (
          <CompanyVoiceSections team={state} />
        )}
      </div>
    </>
  );
}
