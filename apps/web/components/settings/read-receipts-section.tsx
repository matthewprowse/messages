"use client";

// Settings, Accounts, WhatsApp Read Receipts: the privacy switch sits with the accounts it affects.

import { useApp } from "@/lib/store";
import { Switch } from "@/components/ui/switch";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

/** Shown only once a WhatsApp account is connected, because the switch does nothing without one. */
export function ReadReceiptsSection() {
  const { profile, accounts, dispatch } = useApp();
  if (!accounts.some((a) => a.provider === "whatsapp")) return null;
  return (
    <SettingsSection id="read-receipts" title="WhatsApp">
      <SettingsRows>
        <SettingsRow title="Read Receipts" description="Opening a chat here sends blue ticks, like WhatsApp Web. Turn off to read quietly.">
          <Switch checked={profile.whatsappReadReceipts} onCheckedChange={(v) => dispatch({ type: "patchProfile", patch: { whatsappReadReceipts: v } })} aria-label="WhatsApp Read Receipts" />
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}
