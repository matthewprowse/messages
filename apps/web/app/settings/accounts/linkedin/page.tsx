"use client";

// Settings page for connecting LinkedIn: the sign-in form (LinkedInConnect) plus notes on the codes and approvals LinkedIn may ask for.

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { SettingsBody, SettingsHeading, SettingsSection } from "@/components/settings/primitives";
import { SettingsPage } from "@/components/settings/settings-page";
import { LinkedInConnect } from "@/components/linkedin-connect";

export default function LinkedInSetup() {
  useEffect(() => { track("account_connect", { provider: "linkedin", step: "setup", outcome: "start" }); }, []);
  return (
    <SettingsPage title="Connect LinkedIn" back="/settings/accounts">
      <SettingsSection id="connect" title="Sign In"><SettingsBody><LinkedInConnect /></SettingsBody></SettingsSection>
      <SettingsSection id="before-you-connect" title="Before You Connect">
        <SettingsBody className="gap-0">
          <SettingsHeading level={3} title="Codes and Approvals" description={<p>
            LinkedIn may ask for a six digit code, sent to your email or phone or shown by your authenticator app, or ask you to approve the
            sign in in the LinkedIn app. Konva shows it here as soon as LinkedIn asks. If LinkedIn asks for anything else, approve the sign in
            in the LinkedIn app and sign in here again.
          </p>} />
          <SettingsHeading level={3} title="What Konva Does" description={<p>
            It reads your conversations as they arrive and sends only the replies you write. A conversation is marked read on LinkedIn
            only when you open it here, and nothing is ever sent on its own.
          </p>} />
          <SettingsHeading level={3} title="The Risk" description={<p>
            Konva uses LinkedIn&apos;s website messaging through an unofficial open source library. LinkedIn does not allow unofficial
            clients and can restrict an account that uses one. If LinkedIn signs Konva out or limits it, syncing stops and this page says why.
            Signing in again here reconnects it.
          </p>} />
          <SettingsHeading level={3} title="Disconnecting" description={<p>
            Pause Sync in Connected Accounts stops syncing. Signing out of LinkedIn everywhere, under Settings and Privacy, ends the session for good.
          </p>} />
        </SettingsBody>
      </SettingsSection>
    </SettingsPage>
  );
}
