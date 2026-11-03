"use client";

// Settings, Accounts, Sending: the WhatsApp read receipts switch, beside the other sending choices it sits with.

import { useApp } from "@/lib/store";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/components/settings/primitives";

/** The switch row. The page shows it only once a WhatsApp account is connected, because it does nothing without one. */
export function ReadReceiptsRow() {
  const { profile, dispatch } = useApp();
  return (
    <SettingsRow title="WhatsApp Read Receipts">
      <Switch checked={profile.whatsappReadReceipts} onCheckedChange={(v) => dispatch({ type: "patchProfile", patch: { whatsappReadReceipts: v } })} aria-label="WhatsApp Read Receipts" />
    </SettingsRow>
  );
}
