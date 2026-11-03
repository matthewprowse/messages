"use client";

// Settings, Automations: turn a portal enquiry into a Lead with a task and a draft (templates), build your own (Custom), and see
// every run with Undo. Email only for now. Nothing here sends anything.

import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsBody, SettingsSection } from "@/components/settings/primitives";
import { SettingsPage } from "@/components/settings/settings-page";
import { AutomationGallery } from "@/components/settings/automations/automation-gallery";
import { RunHistory } from "@/components/settings/automations/run-history";
import { useAutomations } from "@/components/settings/automations/use-automations";

export default function AutomationsPage() {
  const { automations, runs, loading, error, reload } = useAutomations();
  return (
    <SettingsPage title="Automations">
      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Could Not Load</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loading ? <Skeleton className="h-48 w-full rounded-lg" /> : <AutomationGallery automations={automations} onChanged={() => void reload()} />}
      <SettingsSection id="history" title="Run History">
        {loading ? <SettingsBody><Skeleton className="h-24 w-full rounded-lg" /></SettingsBody> : <RunHistory runs={runs} automations={automations} onChanged={() => void reload()} />}
      </SettingsSection>
    </SettingsPage>
  );
}
