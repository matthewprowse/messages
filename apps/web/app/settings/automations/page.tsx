"use client";

// Settings, Automations: turn a portal enquiry into a Lead with a task and a draft (templates), build your own (Custom), and see
// every run with Undo. Email only for now. Nothing here sends anything.

import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsSection } from "@/components/settings/primitives";
import { AutomationGallery } from "@/components/settings/automations/automation-gallery";
import { RunHistory } from "@/components/settings/automations/run-history";
import { useAutomations } from "@/components/settings/automations/use-automations";

export default function AutomationsPage() {
  const { automations, runs, loading, error, reload } = useAutomations();
  return (
    <>
      <SettingsHeader title="Automations" description="When an email arrives that matches, Konva reads the lead's details and does the first steps for you. It never sends anything without you." />
      <div className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Could Not Load</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loading ? <Skeleton className="h-48 w-full rounded-lg" /> : <AutomationGallery automations={automations} onChanged={() => void reload()} />}
        <SettingsSection id="history" title="Run History" description="The newest 100 runs. Undo removes what a run made.">
          {loading ? <Skeleton className="h-24 w-full rounded-lg" /> : <RunHistory runs={runs} automations={automations} onChanged={() => void reload()} />}
        </SettingsSection>
      </div>
    </>
  );
}
