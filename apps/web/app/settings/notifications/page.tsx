"use client";

// Settings, Notifications: browser push permission and the notification preferences kept on the profile.

import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";
import { BriefSection } from "@/components/settings/brief";

export default function NotificationsPage() {
  const { profile, dispatch, notify } = useApp();
  const [perm, setPerm] = useState<string>("default");
  useEffect(() => { if (typeof Notification !== "undefined") setPerm(Notification.permission); }, []);
  const set = (patch: Partial<typeof profile>) => dispatch({ type: "patchProfile", patch });
  const enablePush = async () => {
    if (typeof Notification === "undefined") return notify("Push is not available in this browser");
    const result = await Notification.requestPermission();
    setPerm(result);
    notify(result === "granted" ? "Push enabled" : "Push not enabled");
  };

  return (
    <>
      <SettingsHeader title="Notifications" description="Push only for what matters. Everything else waits for you." />
      <div className="space-y-3">
        <SettingsSection id="push" title="Push">
          <SettingsRows>
            <SettingsRow title="This Device" description={perm === "granted" ? "Push is enabled here." : "On iPhone, add the app to your Home Screen first, then enable."}>
              <Button variant="secondary" disabled={perm === "granted"} onClick={enablePush}>
                {perm === "granted" ? "Enabled" : "Enable Push"}
              </Button>
            </SettingsRow>
            <SettingsRow title="Urgent" description="Always pushed, even in quiet hours."><Switch checked={profile.pushUrgent} onCheckedChange={(v) => set({ pushUrgent: v })} aria-label="Urgent" /></SettingsRow>
            <SettingsRow title="Important" description="Pushed outside quiet hours."><Switch checked={profile.pushImportant} onCheckedChange={(v) => set({ pushImportant: v })} aria-label="Important" /></SettingsRow>
            <SettingsRow title="Quiet Hours" description="No pushes except Urgent.">
              <Input type="time" value={profile.quietStart} onChange={(e) => e.target.value && set({ quietStart: e.target.value })} className="w-28" aria-label="Quiet Hours Start" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="time" value={profile.quietEnd} onChange={(e) => e.target.value && set({ quietEnd: e.target.value })} className="w-28" aria-label="Quiet Hours End" />
            </SettingsRow>
          </SettingsRows>
        </SettingsSection>

        <SettingsSection id="ai-behaviour" title="AI Behaviour">
          <SettingsRows>
            <SettingsRow title="Auto-Draft Replies" description="A reply is ready when you open a conversation that needs one. You still send it."><Switch checked={profile.autoDraftTop} onCheckedChange={(v) => set({ autoDraftTop: v })} aria-label="Auto-Draft Replies" /></SettingsRow>
            <SettingsRow title="WhatsApp Read Receipts" description="Opening a chat here sends blue ticks, like WhatsApp Web. Turn off to read quietly."><Switch checked={profile.whatsappReadReceipts} onCheckedChange={(v) => set({ whatsappReadReceipts: v })} aria-label="WhatsApp Read Receipts" /></SettingsRow>
          </SettingsRows>
        </SettingsSection>

        <BriefSection />
      </div>
    </>
  );
}
