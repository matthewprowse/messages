"use client";

import { SettingsHeader } from "@/components/settings-header";
import { SettingsHeading } from "@/components/settings/sections";

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "1. Create a Google Cloud Project",
    body: <p>At console.cloud.google.com, choose New Project and name it Messages.</p>,
  },
  {
    title: "2. Turn On Gmail and Calendar",
    body: <p>Under APIs and Services, then Library, open the Gmail API and the Google Calendar API and choose Enable on each.</p>,
  },
  {
    title: "3. Set Up the Consent Screen",
    body: (
      <p>
        Open Google Auth Platform and choose Get Started. Name the app Messages, use your own email for support and contact, and choose External.
        Then, under Audience, choose Publish App so it says In Production. An app left in Testing signs you out every 7 days.
      </p>
    ),
  },
  {
    title: "4. Create the Sign-In Client",
    body: (
      <p>
        Under Clients, choose Create Client with the application type Desktop App. Copy the client ID and secret into apps/worker/.env as
        GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Google shows the secret only once.
      </p>
    ),
  },
  {
    title: "5. Run the Connect Command",
    body: (
      <>
        <p>From the project folder:</p>
        <pre className="mt-2 rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">pnpm connect:google</pre>
        <p className="mt-2">
          Google opens in your browser. It warns that the app is not verified, because it is your own: choose Advanced, then Go to Messages. Leave
          both boxes ticked.
        </p>
      </>
    ),
  },
  {
    title: "6. Restart the Worker",
    body: (
      <>
        <pre className="mt-2 rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">pnpm worker</pre>
        <p className="mt-2">It reads the client from .env when it starts. Gmail then imports the last 30 days, and new mail appears within seconds.</p>
      </>
    ),
  },
];

export default function GoogleSetup() {
  return (
    <>
      <SettingsHeader
        title="Connect Google"
        description="Gmail and Google Calendar connect with one Google sign-in from your terminal, so the sign-in is stored encrypted and never passes through the app."
        back="/settings/accounts"
      />
      <ol className="space-y-6">
        {STEPS.map((step) => (
          <li key={step.title}>
            <SettingsHeading title={step.title} description={step.body} />
          </li>
        ))}
      </ol>
    </>
  );
}
