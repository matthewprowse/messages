"use client";

// Settings, Notifications: push and quiet hours. Nothing here sends a push yet, so every control is shown disabled and
// marked Coming Soon rather than letting people believe they are protected from interruptions; the saved values are
// kept for when push is built.

import { useApp } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

const SOON = <Badge variant="outline">Coming Soon</Badge>;

export default function NotificationsPage() {
  const { profile } = useApp();
  return (
    <>
      <SettingsHeader title="Notifications" description="Push is on its way: only for what matters, with everything else waiting for you. These settings turn on when it arrives." />
      <div className="space-y-3">
        <SettingsSection id="push" title="Push">
          <SettingsRows>
            <SettingsRow title={<>This Device {SOON}</>} description="On iPhone, add the app to your Home Screen first, then enable.">
              <Button variant="secondary" disabled>Enable Push</Button>
            </SettingsRow>
            <SettingsRow title={<>Urgent {SOON}</>} description="Always pushed, even in quiet hours."><Switch checked={profile.pushUrgent} disabled aria-label="Urgent" /></SettingsRow>
            <SettingsRow title={<>Important {SOON}</>} description="Pushed outside quiet hours."><Switch checked={profile.pushImportant} disabled aria-label="Important" /></SettingsRow>
            <SettingsRow title={<>Quiet Hours {SOON}</>} description="No pushes except Urgent.">
              <Input type="time" value={profile.quietStart} disabled className="w-28" aria-label="Quiet Hours Start" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="time" value={profile.quietEnd} disabled className="w-28" aria-label="Quiet Hours End" />
            </SettingsRow>
          </SettingsRows>
        </SettingsSection>
      </div>
    </>
  );
}
