"use client";

// Settings page for connecting Google (Gmail, Calendar, Tasks, and Meet and Chat when chosen): in-app sign-in, then the
// per-part status from the worker. The form and the status list are shared with Microsoft (connect-family.tsx).

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics";
import { MEET_PERSONAL, connectGoogle, googleErrorText } from "@/lib/onboarding";
import { GoogleLogo } from "@/components/provider-logo";
import { SettingsHeader } from "@/components/settings-header";
import { ConnectForm, PartsStatus, type Part } from "@/components/settings/connect-family";

const PARTS: Part[] = [
  { provider: "gmail", label: "Gmail", detail: "Mail from the last 30 days, then new mail within seconds." },
  { provider: "google_calendar", label: "Google Calendar", detail: "Your calendars and their events." },
  { provider: "google_tasks", label: "Google Tasks", detail: "Lists and tasks, synced every few minutes." },
  { provider: "google_meet", label: "Google Meet and Chat", detail: "Meetings appear once they end and their transcript is ready. Chat messages appear within a minute. Google Workspace accounts only." },
];

export default function GoogleSetup() {
  useEffect(() => { track("account_connect", { provider: "google", step: "setup", outcome: "start" }); }, []);
  return (
    <>
      <SettingsHeader
        title="Connect Google"
        description="Gmail, Google Calendar and Google Tasks connect with one Google sign-in, and Meet transcripts and Google Chat with it when you choose. The sign-in is stored encrypted and only used to sync."
        back="/settings/accounts"
      />
      <div className="mb-3"><Suspense><ConnectGoogle /></Suspense></div>
      <PartsStatus parts={PARTS} goToInbox="gmail" />
    </>
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
      optionLabel="Meet Transcripts and Google Chat"
      optionHint="Google Workspace accounts only. Brings in what was said in your Meet calls and your Chat conversations. Personal Gmail accounts have neither."
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
