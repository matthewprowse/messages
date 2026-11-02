"use client";

// Settings, Profile and Privacy: theme, the usage-data switch, setup again, and signing out.

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useApp } from "@/lib/store";
import { signOut, useAuth } from "@/lib/auth";
import { saveOnboarding } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

/** Light, dark or follow the device. */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <SettingsSection id="appearance" title="Appearance">
      <SettingsRows>
        <SettingsRow title="Theme" description="Match your device, or always use light or dark.">
          {mounted && (
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger className="w-32" aria-label="Theme"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent>
            </Select>
          )}
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}

/** What is stored and shared: the usage-data switch. Deleting and exporting your data are planned (docs/PLAN.md). */
export function PrivacySection() {
  const { dispatch, profile } = useApp();
  return (
    <SettingsSection id="privacy" title="Privacy" description="Everything lives in your own database. Credentials and WhatsApp session keys are encrypted at rest, and message content never goes to logs.">
      <SettingsRows>
        <SettingsRow title="Share Usage Data" description="Counts of which screens and features are used, how long things take and how the AI did. Never message text, names, addresses or anything you type.">
          <Switch checked={profile.shareUsage} onCheckedChange={(v) => dispatch({ type: "patchProfile", patch: { shareUsage: v } })} aria-label="Share Usage Data" />
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}

/** Who is signed in, with Sign Out, and a way to run the first-time setup again. */
export function SignInSection() {
  const { session } = useAuth();
  const { notify } = useApp();
  const setup = () => saveOnboarding({ onboarding: "accounts", tour: "done" }).catch(() => notify("Could not start that. Try again."));
  return (
    <SettingsSection id="account" title="Account">
      <SettingsRows>
        <SettingsRow title="Signed In" description={session?.user.email}>
          <Button variant="secondary" onClick={() => signOut()}>Sign Out</Button>
        </SettingsRow>
        <SettingsRow title="Run Setup Again" description="Accounts, what Konva knows about you, contacts and a practice reply.">
          <Button variant="secondary" onClick={setup}>Run Setup</Button>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}
