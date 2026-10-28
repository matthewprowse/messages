"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { SettingsHeader } from "@/components/settings-header";
import { InstagramSetup } from "@/components/instagram-setup";

export default function InstagramPage() {
  useEffect(() => { track("account_connect", { provider: "instagram", step: "setup", outcome: "start" }); }, []);
  return (
    <>
      <SettingsHeader
        title="Connect Instagram"
        description="Konva brings your Instagram direct messages into the Inbox. Business, Creator and Personal accounts all work."
        back="/settings/accounts"
      />
      <InstagramSetup />
    </>
  );
}
