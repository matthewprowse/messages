"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Video } from "lucide-react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { postAsUser } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Command, SetupSteps, type SetupStep } from "../setup-steps";

const STEPS: SetupStep[] = [
  {
    title: "Create a Zoom App",
    body: (
      <p>
        At marketplace.zoom.us, choose Develop, then Build App, and pick General App. Under Basic Information, choose User-Managed, so each
        person signs in with their own Zoom account.
      </p>
    ),
  },
  {
    title: "Add the Redirect Address",
    body: (
      <p>
        Under OAuth Information, enter http://localhost:3000/api/connect/zoom/callback as the OAuth Redirect URL, and add it to the OAuth Allow
        List too. On a server, use its own address in place of http://localhost:3000.
      </p>
    ),
  },
  {
    title: "Choose the Scopes",
    body: (
      <p>
        Under Scopes, add user:read:user, cloud_recording:read:list_user_recordings, meeting:read:meeting, meeting:read:list_past_participants,
        team_chat:read:list_user_sessions, team_chat:read:list_user_messages and team_chat:write:user_message. To read Team Chat, also turn on
        Team Chat under Features, then Surface.
      </p>
    ),
  },
  {
    title: "Copy the Client ID and Secret",
    body: (
      <p>
        From App Credentials, copy the client ID and secret into apps/web/.env.local and apps/worker/.env as ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET.
        Then restart the app.
      </p>
    ),
  },
  {
    title: "Turn On Transcripts in Zoom",
    body: (
      <p>
        Transcripts come from cloud recordings, which need a paid Zoom plan. In Zoom, open Settings, then Recording, turn on Cloud Recording and
        Create Audio Transcript. Meetings recorded without a transcript are transcribed from their audio instead.
      </p>
    ),
  },
  {
    title: "Restart the Worker",
    body: (
      <>
        <Command>pnpm worker</Command>
        <p className="mt-2">
          It reads the app from .env when it starts. Then choose Connect Zoom above. Team Chat imports the last 30 days and checks for new messages
          every minute; recorded meetings are checked every 10 minutes.
        </p>
      </>
    ),
  },
];

export default function ZoomSetup() {
  return (
    <SetupSteps
      provider="zoom"
      title="Connect Zoom"
      description="Your Zoom meetings with their transcripts, and your Team Chat conversations. The sign-in is stored encrypted and only used to sync and to send the replies you write."
      steps={STEPS}
      label="Zoom"
      watch={["zoom"]}
      connect={<Suspense><ConnectZoom /></Suspense>}
    />
  );
}

/** What ?connect_error= from the Zoom callback means, in words. */
function zoomErrorText(code: string): string {
  if (code === "cancelled") return "Zoom sign-in was cancelled. Try again when you are ready.";
  if (code === "not_granted") return "Zoom gave no access to recordings or Team Chat. Check the app's scopes, then try again.";
  if (code === "no_refresh") return "Zoom did not give lasting access. Try again.";
  if (code === "expired") return "That sign-in took too long or was opened in another browser. Try again.";
  return "Zoom could not be connected. Try again.";
}

/** Off to Zoom's sign-in and back here, with the outcome in the address. */
function ConnectZoom() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const failed = params.get("connect_error");
    if (params.get("connected") === "zoom") {
      const partial = params.get("partial");
      toast(partial === "chat" ? "Zoom is connected for meetings. Team Chat was not allowed." : partial === "meetings" ? "Zoom is connected for Team Chat. Recordings were not allowed." : "Zoom is connected.");
      track("account_connect", { provider: "zoom", step: "app", outcome: "done" });
    } else if (failed) {
      setError(zoomErrorText(failed));
      track("account_connect", { provider: "zoom", step: "app", outcome: "failed", code: failed });
    } else return;
    router.replace("/settings/accounts/zoom");
  }, [params, router]);

  const start = async () => {
    setBusy(true);
    setError(null);
    track("account_connect", { provider: "zoom", step: "app", outcome: "start" });
    try {
      const { url } = await postAsUser<{ url: string }>("/api/connect/zoom");
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Zoom could not be connected. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button disabled={busy} onClick={start}><Video /> Connect Zoom</Button>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
