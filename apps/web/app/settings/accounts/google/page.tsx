"use client";

// Settings page for connecting Google (Gmail, Calendar, Tasks, and Meet and Chat when chosen): in-app sign-in, then the
// per-part status from the worker. The form and the status list are shared with Microsoft (connect-family.tsx).

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics";
import { MEET_PERSONAL, connectGoogle, googleErrorText } from "@/lib/onboarding";
import { GoogleLogo } from "@/components/provider-logo";
import { SettingsBody, SettingsSection } from "@/components/settings/primitives";
import { SettingsPage } from "@/components/settings/settings-page";
import { ConnectForm, PartsStatus, type Part } from "@/components/settings/connect-family";

const PARTS: Part[] = [
  { provider: "gmail", label: "Gmail" },
  { provider: "google_calendar", label: "Google Calendar" },
  { provider: "google_tasks", label: "Google Tasks" },
  { provider: "google_meet", label: "Google Meet and Chat" },
];

export default function GoogleSetup() {
  useEffect(() => { track("account_connect", { provider: "google", step: "setup", outcome: "start" }); }, []);
  return (
    <SettingsPage title="Connect Google" back="/settings/accounts">
      <SettingsSection id="connect" title="Sign In"><SettingsBody><Suspense><ConnectGoogle /></Suspense></SettingsBody></SettingsSection>
      <PartsStatus parts={PARTS} goToInbox="gmail" />
    </SettingsPage>
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
      setNotice(params.get("meet") === "personal" ? MEET_PERSONAL : "Signed in with Google. What each part is doing is below.");
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
    <ConnectForm
      optionId="google-meet"
      optionLabel="Meet Transcripts and Google Chat (Google Workspace Only)"
      checked={meet}
      onChecked={setMeet}
      busy={busy}
      onStart={start}
      logo={<GoogleLogo />}
      buttonLabel="Connect Google"
      error={error}
      notice={notice}
    />
  );
}
