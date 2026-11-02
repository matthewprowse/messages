"use client";

// Settings, Team, Activity: how fast clients are answered, and how many chats people shared and moved back. Counts and times only.

import { useTeam } from "@/lib/team";
import { useResponseStats } from "@/lib/team-work";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsEmpty } from "@/components/settings/primitives";
import { MovedBackSection, ResponseSection } from "@/components/settings/team-activity";

export default function ActivityPage() {
  const { state } = useTeam();
  const { stats, weeks, failed, load } = useResponseStats();
  const manages = state?.role === "owner" || state?.role === "admin";
  return (
    <>
      <SettingsHeader title="Activity" description={state?.workspace?.name ?? "How the team answers its clients."} back="/settings/team" />
      <div className="space-y-3">
        {!state ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : !manages ? (
          <SettingsEmpty>Only an owner or admin can see the team&apos;s activity.</SettingsEmpty>
        ) : (
          <>
            <ResponseSection stats={stats} failed={failed} load={load} />
            <MovedBackSection weeks={weeks} ready={!!stats} />
          </>
        )}
      </div>
    </>
  );
}
