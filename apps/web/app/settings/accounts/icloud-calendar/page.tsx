"use client";

import { Command, SetupSteps, type SetupStep } from "../setup-steps";

const STEPS: SetupStep[] = [
  {
    title: "Create an App-Specific Password",
    body: "At account.apple.com, under Sign-In and Security. If iCloud+ Mail is already connected, its password can be reused and you can skip this.",
  },
  { title: "Run the Connect Command", body: <><p>From the project folder:</p><Command>pnpm connect:icloud-calendar</Command></> },
  { title: "Keep the Worker Running", body: <><Command>pnpm worker</Command><p className="mt-2">Your events then appear in Calendar and update every few minutes.</p></> },
];

export default function ICloudCalendarSetup() {
  return (
    <SetupSteps
      provider="icloud_calendar"
      title="Connect iCloud Calendar"
      description="iCloud Calendar is connected from your terminal, so the app-specific password is typed only there, checked with iCloud, and stored encrypted. New events from the app can be added to it too."
      steps={STEPS}
      label="iCloud Calendar"
      watch={["icloud_calendar"]}
    />
  );
}
