"use client";

// Settings, Notifications: web push for this device, which kinds of message are pushed, and quiet hours. A push says
// only that a message waits (never who or what), and Urgent is the one kind that still comes through in quiet hours.

import { useApp } from "@/lib/store";
import { usePush } from "@/lib/use-push";
import type { PushAvailability } from "@/lib/push";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { SettingsPage } from "@/components/settings/settings-page";

/** What the This Device row says: whether push is on, or why it cannot be turned on here. That is state, so it stays. */
function deviceNote(availability: PushAvailability | undefined, on: boolean): string | undefined {
  if (on) return "On";
  switch (availability) {
    case "needs-install": return "On iPhone and iPad, add Konva to your Home Screen first (Share, then Add to Home Screen), open it from there, then enable.";
    case "unsupported": return "This browser cannot receive push. Try Chrome, Edge, Firefox or Safari 16.4 or later.";
    case "unconfigured": return "Push is not set up on this server yet.";
    case "blocked": return "Notifications are blocked for Konva in your browser settings. Allow them there, then enable.";
    default: return undefined;
  }
}

export default function NotificationsPage() {
  const { profile, dispatch, notify } = useApp();
  const push = usePush();
  const set = (patch: Partial<typeof profile>) => dispatch({ type: "patchProfile", patch });
  const toggle = async () => {
    const problem = await (push.on ? push.disable() : push.enable());
    notify(problem ?? (push.on ? "Push turned off" : "Push enabled"));
  };
  const usable = push.availability === "ready";

  return (
    <SettingsPage title="Notifications">
      <SettingsSection id="push" title="Push">
        <SettingsRows>
          <SettingsRow title="This Device" description={deviceNote(push.availability, push.on)}>
            <Button variant="secondary" disabled={push.busy || (!usable && !push.on)} onClick={toggle}>{push.on ? "Turn Off" : "Enable Push"}</Button>
          </SettingsRow>
          <SettingsRow title="Urgent"><Switch checked={profile.pushUrgent} onCheckedChange={(v) => set({ pushUrgent: v })} aria-label="Urgent" /></SettingsRow>
          <SettingsRow title="Important"><Switch checked={profile.pushImportant} onCheckedChange={(v) => set({ pushImportant: v })} aria-label="Important" /></SettingsRow>
          <SettingsRow title="Quiet Hours">
            <Input type="time" value={profile.quietStart.slice(0, 5)} onChange={(e) => e.target.value && set({ quietStart: e.target.value })} className="w-28" aria-label="Quiet Hours Start" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="time" value={profile.quietEnd.slice(0, 5)} onChange={(e) => e.target.value && set({ quietEnd: e.target.value })} className="w-28" aria-label="Quiet Hours End" />
          </SettingsRow>
        </SettingsRows>
      </SettingsSection>
    </SettingsPage>
  );
}
