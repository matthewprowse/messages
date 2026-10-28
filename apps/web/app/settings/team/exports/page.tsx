"use client";

// Settings, Team, Compliance Exports: the log of client work history exports. Counts and names only, never any text.

import { useTeam } from "@/lib/team";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsEmpty } from "@/components/settings/sections";
import { ExportLogSection } from "@/components/settings/team-exports";

export default function ExportsPage() {
  const { state } = useTeam();
  const allowed = state?.role === "owner" || state?.role === "admin" || (state?.role === "compliance" && !!state.workspace?.strictSharing);
  return (
    <>
      <SettingsHeader title="Compliance Exports" description={state?.workspace?.name ?? "Exports of a client's work history."} back="/settings/team" />
      <div className="space-y-3">
        {!state ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : !allowed ? (
          <SettingsEmpty>Only an owner or admin, or Compliance while strict sharing is on, can see the export log.</SettingsEmpty>
        ) : (
          <ExportLogSection team={state} />
        )}
      </div>
    </>
  );
}
