"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsHeading, SettingsSection } from "@/components/settings/sections";
import { LinkedInConnect } from "@/components/linkedin-connect";

export default function LinkedInSetup() {
  useEffect(() => { track("account_connect", { provider: "linkedin", step: "setup", outcome: "start" }); }, []);
  return (
    <>
      <SettingsHeader
        title="Connect LinkedIn"
        description="Sign in with the email and password you use for LinkedIn to bring your messages into the Inbox. They are stored encrypted and only used to sync your messages."
        back="/settings/accounts"
      />

      <LinkedInConnect />

      <div className="mt-8">
        <SettingsSection id="before-you-connect" title="Before You Connect">
          <SettingsHeading level={3} title="Codes and Approvals" description={<p>
            LinkedIn may ask for a 6-digit code, sent to your email or phone or shown by your authenticator app, or ask you to approve the
            sign-in in the LinkedIn app. Konva shows it here as soon as LinkedIn asks. If LinkedIn asks for anything else, approve the sign-in
            in the LinkedIn app and sign in here again.
          </p>} />
          <SettingsHeading level={3} title="What Konva Does" description={<p>
            It reads your conversations as they arrive and sends only the replies you write. A conversation is marked read on LinkedIn
            only when you open it here, and nothing is ever sent on its own.
          </p>} />
          <SettingsHeading level={3} title="The Risk" description={<p>
            Konva uses LinkedIn&apos;s website messaging through an unofficial open-source library. LinkedIn does not allow unofficial
            clients and can restrict an account that uses one. If LinkedIn signs Konva out or limits it, syncing stops and this page says why.
            Signing in again here reconnects it.
          </p>} />
          <SettingsHeading level={3} title="Disconnecting" description={<p>
            Pause Sync in Connected Accounts stops syncing. Signing out of LinkedIn everywhere, under Settings and Privacy, ends the session for good.
          </p>} />
        </SettingsSection>
      </div>
    </>
  );
}
