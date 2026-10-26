"use client";

import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { LinkedInConnectForm } from "@/components/linkedin-connect";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SettingsHeading } from "@/components/settings/sections";
import { Command, SetupSteps, type SetupStep } from "../setup-steps";

const STEPS: SetupStep[] = [
  { title: "Build the LinkedIn Helper", body: <><p>Once, from the project folder. It needs Go 1.26 or newer:</p><Command>pnpm linkedin:build</Command></> },
  { title: "Keep the Worker Running", body: <><Command>pnpm worker</Command><p className="mt-2">New LinkedIn messages then appear in Conversations as they arrive.</p></> },
];

export default function LinkedInSetup() {
  const { accounts } = useApp();
  const account = accounts.find((a) => a.provider === "linkedin");
  return (
    <SetupSteps
      provider="linkedin"
      title="Connect LinkedIn"
      description="LinkedIn connects with the session cookies from a browser where you are signed in. They are stored encrypted and only used to sync your messages."
      steps={STEPS}
      label="LinkedIn"
      watch={["linkedin"]}
      connect={
        <div className="max-w-xl space-y-6">
          {account?.status === "error" && account.statusDetail && (
            <Alert variant="destructive">
              <AlertTitle>Needs Attention</AlertTitle>
              <AlertDescription>{account.statusDetail}</AlertDescription>
            </Alert>
          )}
          <LinkedInConnectForm onSaved={() => toast("Saved. LinkedIn connects within a few seconds.")} />
          <div className="space-y-4">
            <SettingsHeading level={3} title="What Konva Does" description={<p>
              It reads your conversations as they arrive and sends only the replies you write. A conversation is marked read on LinkedIn
              only when you open it here, and nothing is ever sent on its own.
            </p>} />
            <SettingsHeading level={3} title="The Risk" description={<p>
              Konva uses LinkedIn&apos;s website messaging through an unofficial open-source library. LinkedIn does not allow unofficial
              clients and can restrict an account that uses one. If LinkedIn signs Konva out or limits it, syncing stops and this page says why.
            </p>} />
            <SettingsHeading level={3} title="Disconnecting" description={<p>
              Pause Sync in Connected Accounts stops syncing. Signing out of LinkedIn everywhere, under Settings and Privacy, ends the session for good.
            </p>} />
          </div>
        </div>
      }
    />
  );
}
