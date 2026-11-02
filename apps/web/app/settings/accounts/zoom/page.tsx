"use client";

// Settings page for connecting Zoom: in-app sign-in via ConnectZoom.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Video } from "lucide-react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { postAsUser } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { SetupSteps } from "../setup-steps";

export default function ZoomSetup() {
  return (
    <SetupSteps
      provider="zoom"
      title="Connect Zoom"
      description="Your Zoom meetings with their transcripts, and your Team Chat conversations. The sign-in is stored encrypted and only used to sync and to send the replies you write."
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
      <Button variant="secondary" disabled={busy} onClick={start}><Video /> Connect Zoom</Button>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
