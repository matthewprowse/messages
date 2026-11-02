"use client";

// Settings page for connecting Google (Gmail, Calendar, Tasks, and Meet and Chat when chosen): in-app sign-in via ConnectGoogle.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics";
import { MEET_PERSONAL, connectGoogle, googleErrorText } from "@/lib/onboarding";
import { useApp } from "@/lib/store";
import { GoogleLogo } from "@/components/provider-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { SettingsRow, SettingsRows } from "@/components/settings/sections";
import { SetupSteps } from "../setup-steps";

export default function GoogleSetup() {
  return (
    <SetupSteps
      provider="google"
      title="Connect Google"
      description="Gmail, Google Calendar and Google Tasks connect with one Google sign-in, and Meet transcripts and Google Chat with it when you choose. The sign-in is stored encrypted and only used to sync."
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
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [meet, setMeet] = useState(false);

  useEffect(() => {
    const failed = params.get("connect_error");
    if (params.get("connected") === "google") {
      setDone(true);
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
    setDone(false);
    track("account_connect", { provider: "google", step: "app", outcome: "start" });
    try {
      await connectGoogle("/settings/accounts/google", { meet });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google could not be connected. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
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
        <Button variant="secondary" disabled={busy} onClick={start}><GoogleLogo /> Connect Google</Button>
        {error && <FieldError>{error}</FieldError>}
        {done && <FieldDescription>Signed in with Google. What each part is doing is below.</FieldDescription>}
        {notice && <FieldDescription>{notice}</FieldDescription>}
      </div>
      <GoogleParts />
      <MeetStatus />
    </div>
  );
}

const PARTS = [
  { provider: "gmail", name: "Gmail" },
  { provider: "google_calendar", name: "Google Calendar" },
  { provider: "google_tasks", name: "Google Tasks" },
] as const;

/** What each part of the sign-in is doing, with what Google said when one is not working. */
function GoogleParts() {
  const { accounts } = useApp();
  const parts = PARTS.map((p) => ({ ...p, account: accounts.find((a) => a.provider === p.provider) })).filter((p) => p.account);
  if (parts.length === 0) return null;
  return (
    <SettingsRows>
      {parts.map(({ provider, name, account }) => (
        <SettingsRow
          key={provider}
          title={<>{name} {account!.status === "error" ? <Badge variant="destructive">Needs Attention</Badge> : account!.status === "connected" || account!.status === "syncing" ? <Badge variant="secondary">Connected</Badge> : <Badge variant="outline">Connecting</Badge>}</>}
          description={account!.status === "error" ? account!.statusDetail : undefined}
        />
      ))}
    </SettingsRows>
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
