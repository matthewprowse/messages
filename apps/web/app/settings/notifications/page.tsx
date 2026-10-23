"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";

export default function NotificationsPage() {
  const { profile, dispatch, notify } = useApp();
  const [perm, setPerm] = useState<string>("default");
  useEffect(() => { if (typeof Notification !== "undefined") setPerm(Notification.permission); }, []);
  const set = (patch: Partial<typeof profile>) => dispatch({ type: "patchProfile", patch });

  return (
    <>
      <SettingsHeader title="Notifications" description="Push only for what matters. Everything else waits for you." />
      <div className="space-y-8">
        <SettingsSection id="push" title="Push">
          <SettingsRows>
            <SettingsRow title="This Device" description={perm === "granted" ? "Push is enabled here." : "On iPhone, add the app to your Home Screen first, then enable."}>
              <Button size="sm" variant={perm === "granted" ? "outline" : "default"} disabled={perm === "granted"} onClick={async () => { if (typeof Notification === "undefined") return notify("Push is not available in this browser"); const p = await Notification.requestPermission(); setPerm(p); notify(p === "granted" ? "Push enabled" : "Push not enabled"); }}>
                {perm === "granted" ? "Enabled" : "Enable Push"}
              </Button>
            </SettingsRow>
            <SettingsRow title="Urgent" description="Always pushed, even in quiet hours."><Switch checked={profile.pushUrgent} onCheckedChange={(v) => set({ pushUrgent: v })} aria-label="Urgent" /></SettingsRow>
            <SettingsRow title="Important" description="Pushed outside quiet hours."><Switch checked={profile.pushImportant} onCheckedChange={(v) => set({ pushImportant: v })} aria-label="Important" /></SettingsRow>
            <SettingsRow title="Quiet Hours" description="No pushes except Urgent.">
              <Input type="time" value={profile.quietStart} onChange={(e) => set({ quietStart: e.target.value })} className="w-28" aria-label="Quiet Hours Start" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="time" value={profile.quietEnd} onChange={(e) => set({ quietEnd: e.target.value })} className="w-28" aria-label="Quiet Hours End" />
            </SettingsRow>
          </SettingsRows>
        </SettingsSection>

        <SettingsSection id="ai-behaviour" title="AI Behaviour">
          <SettingsRows>
            <SettingsRow title="Auto-Draft Top Priority Threads" description="A reply is ready when you open an Urgent or Important thread. You still send it."><Switch checked={profile.autoDraftTop} onCheckedChange={(v) => set({ autoDraftTop: v })} aria-label="Auto-Draft Top Priority Threads" /></SettingsRow>
            <SettingsRow title="WhatsApp Read Receipts" description="Opening a chat here sends blue ticks, like WhatsApp Web. Turn off to read quietly."><Switch checked={profile.whatsappReadReceipts} onCheckedChange={(v) => set({ whatsappReadReceipts: v })} aria-label="WhatsApp Read Receipts" /></SettingsRow>
            <SettingsRow title="Morning Briefing" description="Delivered in the app and as a push."><Input type="time" defaultValue="07:00" className="w-28" aria-label="Morning Briefing Time" /></SettingsRow>
          </SettingsRows>
        </SettingsSection>
      </div>
    </>
  );
}
