"use client";

// Settings page for connecting Microsoft (Outlook, Calendar, To Do, Teams): in-app sign-in, an admin-approval link when a
// work account needs one (from /api/connect/microsoft/admin-link, never from the address), then the per-part status from the worker. The form and the status list are shared with Google
// (connect-family.tsx).

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { connectMicrosoft, microsoftErrorText } from "@/lib/onboarding";
import { BrandLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { SettingsBody, SettingsSection } from "@/components/settings/primitives";
import { SettingsPage } from "@/components/settings/settings-page";
import { ConnectForm, PartsStatus, type Part } from "@/components/settings/connect-family";
import { isAdminLink } from "@/app/api/connect/microsoft/shared";

const PARTS: Part[] = [
  { provider: "outlook", label: "Outlook" },
  { provider: "outlook_calendar", label: "Outlook Calendar" },
  { provider: "microsoft_todo", label: "Microsoft To Do" },
  { provider: "teams", label: "Microsoft Teams" },
];

export default function MicrosoftSetup() {
  useEffect(() => { track("account_connect", { provider: "microsoft", step: "setup", outcome: "start" }); }, []);
  return (
    <SettingsPage title="Connect Microsoft" back="/settings/accounts">
      <SettingsSection id="connect" title="Sign In"><SettingsBody><Suspense><ConnectMicrosoft /></Suspense></SettingsBody></SettingsSection>
      <PartsStatus parts={PARTS} goToInbox="outlook" />
    </SettingsPage>
  );
}

/** The address an IT admin opens to approve the app, from our own server and checked again here, or null when there is none. */
async function adminApprovalLink(teams: boolean, calendarWrite: boolean): Promise<string | null> {
  try {
    const query = new URLSearchParams({ ...(teams ? { teams: "1" } : {}), ...(calendarWrite ? { calendar_write: "1" } : {}) });
    const res = await fetch(`/api/connect/microsoft/admin-link?${query}`, { cache: "no-store" });
    const link = res.ok ? ((await res.json()) as { link?: unknown }).link : null;
    return typeof link === "string" && isAdminLink(link, process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID?.trim() || undefined) ? link : null;
  } catch {
    return null;
  }
}

/** Off to Microsoft's sign-in and back here, with the outcome in the address. */
function ConnectMicrosoft() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adminLink, setAdminLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState(false);

  useEffect(() => {
    const failed = params.get("connect_error");
    if (params.get("connected") === "microsoft") {
      toast("Microsoft is connected.");
      const notes = [
        params.get("mail") === "missing" && "Mail access was not granted, so Outlook is not connected. Connect again to add it.",
        params.get("send") === "missing" && "Sending was not granted, so replies cannot go out through Outlook. Connect again to allow it.",
        params.get("teams") === "missing" && "Teams access was not granted, so Teams is not connected. Your IT admin may need to approve it first.",
      ].filter(Boolean);
      if (notes.length) setNotice(notes.join(" "));
      track("account_connect", { provider: "microsoft", step: "app", outcome: "done" });
    } else if (failed) {
      setError(microsoftErrorText(failed));
      // Only which permissions were asked comes from the address; the link is built by the server from our own client id.
      if (failed === "admin_approval") void adminApprovalLink(params.get("admin_teams") === "1", params.get("admin_calendar_write") === "1").then(setAdminLink);
      track("account_connect", { provider: "microsoft", step: "app", outcome: "failed", code: failed });
    } else return;
    router.replace("/settings/accounts/microsoft");
  }, [params, router]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setAdminLink(null);
    track("account_connect", { provider: "microsoft", step: "app", outcome: "start" });
    try {
      await connectMicrosoft("/settings/accounts/microsoft", { teams });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microsoft could not be connected. Try again.");
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(adminLink ?? "");
      toast("Link copied.");
    } catch {
      toast("Could not copy. Select the link and copy it instead.");
    }
  };

  return (
    <ConnectForm
      optionId="microsoft-teams"
      optionLabel="Also Connect Teams (Work or School Accounts)"
      checked={teams}
      onChecked={setTeams}
      busy={busy}
      onStart={start}
      logo={<BrandLogo brand="microsoft" />}
      buttonLabel="Connect Microsoft"
      error={error}
      notice={notice}
    >
      {adminLink && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Ask Your IT Admin to Approve</p>
          <code className="block break-all text-xs text-muted-foreground">{adminLink}</code>
          <div><Button variant="secondary" onClick={copyLink}>Copy Link</Button></div>
        </div>
      )}
    </ConnectForm>
  );
}
