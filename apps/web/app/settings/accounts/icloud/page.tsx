"use client";

import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { ICloudConnectForm } from "@/components/icloud-connect";
import { Command, SetupSteps, type SetupStep } from "../setup-steps";

const STEPS: SetupStep[] = [
  { title: "Create an App-Specific Password", body: "At account.apple.com, under Sign-In and Security. It is four groups of four letters." },
  { title: "Run the Connect Command", body: <><p>From the project folder:</p><Command>pnpm connect:icloud</Command></> },
  { title: "Keep the Worker Running", body: <><Command>pnpm worker</Command><p className="mt-2">New mail then appears in Conversations within seconds.</p></> },
];

export default function ICloudSetup() {
  const { session } = useAuth();
  return (
    <SetupSteps
      provider="icloud"
      title="Connect iCloud+ Mail"
      description="iCloud Mail connects with an app-specific password, which is checked with iCloud and stored encrypted. iCloud Calendar can connect with it too."
      steps={STEPS}
      label="iCloud+ Mail"
      watch={["icloud"]}
      connect={
        <div className="max-w-sm">
          <ICloudConnectForm
            defaultEmail={session?.user.email ?? ""}
            onConnected={({ calendar }) => toast(calendar ? "iCloud Mail and Calendar are connected." : "iCloud Mail is connected. Calendar did not accept the same sign-in.")}
          />
        </div>
      }
    />
  );
}
