"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { connectMicrosoft, microsoftErrorText } from "@/lib/onboarding";
import { useApp } from "@/lib/store";
import type { Provider } from "@/lib/types";
import { BrandLogo } from "@/components/provider-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsHeading, SettingsRow, SettingsRows } from "@/components/settings/sections";

const PARTS: { provider: Provider; label: string; detail: string }[] = [
  { provider: "outlook", label: "Outlook", detail: "Mail from the last 30 days, then new mail within seconds." },
  { provider: "outlook_calendar", label: "Outlook Calendar", detail: "Your calendars and their events." },
  { provider: "microsoft_todo", label: "Microsoft To Do", detail: "Lists and tasks, synced every few minutes." },
  { provider: "teams", label: "Microsoft Teams", detail: "Chats, and meeting transcripts once Teams has written them. Work or school accounts only." },
];

export default function MicrosoftSetup() {
  useEffect(() => { track("account_connect", { provider: "microsoft", step: "setup", outcome: "start" }); }, []);
  return (
    <>
      <SettingsHeader
        title="Connect Microsoft"
        description="Outlook, Outlook Calendar and Microsoft To Do connect with one Microsoft sign-in, and Teams chats and meeting transcripts with it when you choose, for work or school accounts. The sign-in is stored encrypted and only used to sync."
        back="/settings/accounts"
      />
      <div className="mb-8"><Suspense><ConnectMicrosoft /></Suspense></div>
      <Status />
      <OwnerSetup />
    </>
  );
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
      const admin = params.get("admin");
      if (failed === "admin_approval" && admin?.startsWith("https://login.microsoftonline.com/")) setAdminLink(admin);
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
    <div className="space-y-4">
      <Field orientation="horizontal">
        <Checkbox id="microsoft-teams" checked={teams} disabled={busy} onCheckedChange={(on) => setTeams(on === true)} />
        <FieldContent>
          <FieldLabel htmlFor="microsoft-teams">Also Connect Teams (Work or School Accounts)</FieldLabel>
          <FieldDescription>
            Brings in your Teams chats and meeting transcripts. Personal Microsoft accounts have neither, and Microsoft turns the whole sign-in away
            if you tick this for one. Your IT admin may need to approve it.
          </FieldDescription>
        </FieldContent>
      </Field>
      <div className="space-y-2">
        <Button disabled={busy} onClick={start}><BrandLogo brand="microsoft" /> Connect Microsoft</Button>
        {error && <FieldError>{error}</FieldError>}
        {notice && <FieldDescription>{notice}</FieldDescription>}
      </div>
      {adminLink && (
        <SettingsRows>
          <SettingsRow
            title="Ask Your IT Admin to Approve"
            description="An admin can approve Konva for everyone by opening this link and accepting. Then connect again. The last page may not load; the approval is saved regardless."
          >
            <Button size="sm" onClick={copyLink}>Copy Link</Button>
          </SettingsRow>
          <div className="px-4 py-3"><code className="block break-all text-xs text-muted-foreground">{adminLink}</code></div>
        </SettingsRows>
      )}
    </div>
  );
}

/** Each part, as the worker reports it. A part that is not connected shows as Not Connected. */
function Status() {
  const { accounts } = useApp();
  return (
    <section className="space-y-3" aria-live="polite">
      <SettingsHeading title="Status" />
      <SettingsRows>
        {PARTS.map((part) => {
          const found = accounts.filter((a) => a.provider === part.provider);
          const live = found.some((a) => a.status === "connected" || a.status === "syncing");
          const problem = !live && found.some((a) => a.status === "error");
          const connecting = !live && !problem && found.length > 0;
          const first = found.find((a) => a.statusDetail);
          return (
            <SettingsRow
              key={part.provider}
              title={
                <>
                  {part.label}{" "}
                  {live ? <Badge variant="secondary">Connected</Badge>
                    : problem ? <Badge variant="destructive">Needs Attention</Badge>
                    : connecting ? <Badge variant="outline" className="gap-1"><RefreshCw className="size-3 animate-spin" /> Connecting</Badge>
                    : <Badge variant="outline">Not Connected</Badge>}
                </>
              }
              description={problem && first?.statusDetail ? first.statusDetail : part.detail}
            >
              {live && part.provider === "outlook" && <Button size="sm" asChild><Link href="/inbox">Go to Inbox</Link></Button>}
            </SettingsRow>
          );
        })}
      </SettingsRows>
    </section>
  );
}

/** What the server owner does once, in Microsoft Entra and the two .env files. Collapsed, as it is not for users. */
function OwnerSetup() {
  const [origin, setOrigin] = useState("your app address");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <details className="group mt-8 rounded-lg border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Setup for the Server Owner</summary>
      <ol className="list-decimal space-y-4 border-t px-4 py-4 pl-8 text-sm text-muted-foreground">
        <li>
          At entra.microsoft.com, open App Registrations and choose New Registration. Name it Konva. Under Supported Account Types, choose
          Accounts in Any Organizational Directory and Personal Microsoft Accounts.
        </li>
        <li>
          Under Authentication, choose Add a Platform, then Mobile and Desktop Applications (Public Client/Native), and add both redirect
          addresses: <code className="text-foreground">http://localhost</code> for the worker and{" "}
          <code className="break-all text-foreground">{origin}/api/connect/microsoft/callback</code> for this page. Microsoft needs the second one
          to match exactly. No client secret is needed.
        </li>
        <li>
          Under API Permissions, add these Microsoft Graph delegated permissions: Mail.ReadWrite, Mail.Send, Calendars.Read, Tasks.ReadWrite,
          User.Read and offline_access. For Teams, also add Chat.ReadWrite, OnlineMeetings.Read and OnlineMeetingTranscript.Read.All. Users
          agree to them when they sign in. Many organisations let only an IT admin approve the Teams ones; the page then shows a link for the
          admin.
        </li>
        <li>
          Copy the Application (Client) ID from the app&apos;s Overview into both apps/web/.env.local and apps/worker/.env as
          MICROSOFT_CLIENT_ID. Set MICROSOFT_TENANT in both only to limit sign-in to one organisation. Then restart the app and the worker so
          they read it.
        </li>
      </ol>
    </details>
  );
}
