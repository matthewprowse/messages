"use client";

// Settings, Team, Work Chats: for an owner or admin to find a client and assign it, and for Compliance to open chats.

import { useAuth } from "@/lib/auth";
import { useTeam } from "@/lib/team";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsEmpty } from "@/components/settings/sections";
import { WorkChatsSection } from "@/components/settings/team-work";

export default function WorkChatsPage() {
  const { session } = useAuth();
  const { state } = useTeam();
  const userId = session?.user.id;
  const allowed = state?.role === "owner" || state?.role === "admin" || (state?.role === "compliance" && !!state.workspace?.strictSharing);
  return (
    <>
      <SettingsHeader title="Work Chats" description={state?.workspace?.name ?? "The chats your team shares."} back="/settings/team" />
      <div className="space-y-3">
        {!state || !userId ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : !allowed ? (
          <SettingsEmpty>Only an owner or admin, or Compliance while strict sharing is on, can see the team&apos;s work chats.</SettingsEmpty>
        ) : (
          <WorkChatsSection team={state} userId={userId} />
        )}
      </div>
    </>
  );
}
