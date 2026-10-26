"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { MEET_PERSONAL, connectGoogle, googleErrorText } from "@/lib/onboarding";
import { useApp } from "@/lib/store";
import { GoogleLogo } from "@/components/provider-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { SettingsRow, SettingsRows } from "@/components/settings/sections";
import { Command, SetupSteps, type SetupStep } from "../setup-steps";

const STEPS: SetupStep[] = [
  {
    title: "Create a Google Cloud Project",
    body: <p>At console.cloud.google.com, choose New Project and name it Messages.</p>,
  },
  {
    title: "Turn On Gmail, Calendar and Tasks",
    body: <p>Under APIs and Services, then Library, open the Gmail API, the Google Calendar API and the Google Tasks API and choose Enable on each.</p>,
  },
  {
    title: "Turn On Meet and Chat",
    body: (
      <p>
        Only for Meet Transcripts and Google Chat, which need a Google Workspace account. In the same Library, enable the Google Meet REST API and
        the Google Chat API. Then open the Google Chat API&apos;s Configuration tab, give the Chat app the name Messages, an avatar URL and a
        description, turn off Interactive Features, and save. Chat refuses every request until this is done. Transcripts also need a Workspace
        plan with Meet transcription, turned on in each meeting.
      </p>
    ),
  },
  {
    title: "Set Up the Consent Screen",
    body: (
      <p>
        Open Google Auth Platform and choose Get Started. Name the app Messages, use your own email for support and contact, and choose External.
        Then, under Audience, choose Publish App so it says In Production. An app left in Testing signs you out every 7 days.
      </p>
    ),
  },
  {
    title: "Create the Sign-In Client",
    body: (
      <p>
        Under Clients, choose Create Client with the application type Desktop App. Copy the client ID and secret into apps/worker/.env as
        GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Google shows the secret only once.
      </p>
    ),
  },
  {
    title: "Run the Connect Command",
    body: (
      <>
        <p>From the project folder:</p>
        <Command>pnpm connect:google</Command>
        <p className="mt-2">
          It asks whether to connect Meet transcripts and Google Chat as well. Google then opens in your browser. It warns that the app is not
          verified, because it is your own: choose Advanced, then Go to Messages. Leave every box ticked, including Google Tasks.
        </p>
      </>
    ),
  },
  {
    title: "Restart the Worker",
    body: (
      <>
        <Command>pnpm worker</Command>
        <p className="mt-2">It reads the client from .env when it starts. Gmail then imports the last 30 days, and new mail appears within seconds.</p>
      </>
    ),
  },
];

export default function GoogleSetup() {
  return (
    <SetupSteps
      provider="google"
      title="Connect Google"
      description="Gmail, Google Calendar and Google Tasks connect with one Google sign-in, and Meet transcripts and Google Chat with it when you choose. The sign-in is stored encrypted and only used to sync."
      steps={STEPS}
      label="Google"
      watch={["gmail", "google_calendar", "google_tasks", "google_meet"]}
      connect={<Suspense><ConnectGoogle /></Suspense>}
    />
  );
}

/** Off to Google's sign-in and back here, with the outcome in the address. */
function ConnectGoogle() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meet, setMeet] = useState(false);

  useEffect(() => {
    const failed = params.get("connect_error");
    if (params.get("connected") === "google") {
      toast("Google is connected.");
      if (params.get("meet") === "personal") setNotice(MEET_PERSONAL);
      track("account_connect", { provider: "google", step: "app", outcome: "done" });
    } else if (failed) {
      setError(googleErrorText(failed));
      track("account_connect", { provider: "google", step: "app", outcome: "failed", code: failed });
    } else return;
    router.replace("/settings/accounts/google");
  }, [params, router]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    track("account_connect", { provider: "google", step: "app", outcome: "start" });
    try {
      await connectGoogle("/settings/accounts/google", { meet });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google could not be connected. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field orientation="horizontal">
        <Checkbox id="google-meet" checked={meet} disabled={busy} onCheckedChange={(on) => setMeet(on === true)} />
        <FieldContent>
          <FieldLabel htmlFor="google-meet">Meet Transcripts and Google Chat</FieldLabel>
          <FieldDescription>
            Google Workspace accounts only. Brings in what was said in your Meet calls and your Chat conversations. Personal Gmail accounts have
            neither.
          </FieldDescription>
        </FieldContent>
      </Field>
      <div className="space-y-2">
        <Button disabled={busy} onClick={start}><GoogleLogo /> Connect Google</Button>
        {error && <FieldError>{error}</FieldError>}
        {notice && <FieldDescription>{notice}</FieldDescription>}
      </div>
      <MeetStatus />
    </div>
  );
}

/**
 * The Meet and Chat account once there is one, with what the worker found: a personal account, Chat or Meet
 * not set up in the Cloud project, or recent meetings that all came without a transcript.
 */
function MeetStatus() {
  const { accounts } = useApp();
  const account = accounts.find((a) => a.provider === "google_meet");
  if (!account) return null;
  const problem = account.status === "error";
  return (
    <SettingsRows>
      <SettingsRow
        title={<>Google Meet and Chat {problem ? <Badge variant="destructive">Needs Attention</Badge> : account.status === "connected" ? <Badge variant="secondary">Connected</Badge> : <Badge variant="outline">Connecting</Badge>}</>}
        description={account.statusDetail ?? "Meetings appear once they end and their transcript is ready. Chat messages appear within a minute."}
      />
    </SettingsRows>
  );
}
