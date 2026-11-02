"use client";

// Settings page for linking WhatsApp as a linked device. The QR flow is in WhatsAppLinkPanel; notes on staying linked show until it is.

import { useEffect } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsHeading, SettingsSection } from "@/components/settings/sections";
import { useWhatsAppLink, WhatsAppLinkPanel } from "@/components/whatsapp-link";

export default function WhatsAppSetup() {
  useEffect(() => { track("account_connect", { provider: "whatsapp", step: "setup", outcome: "start" }); }, []);
  const link = useWhatsAppLink();
  const { account, linked } = link;

  return (
    <>
      <SettingsHeader title="Link WhatsApp" description="Konva joins your WhatsApp as a linked device, the same way WhatsApp Web does." back="/settings/accounts" />

      <WhatsAppLinkPanel link={link} />

      {account !== undefined && !linked && <div className="mt-3">
        <SettingsSection id="before-you-link" title="Before You Link">
          <SettingsHeading level={3} title="Your Phone Stays in Charge" description={<>
            <p>
              WhatsApp keeps a linked device only while your phone comes online at least once every 14 days. If it does not, WhatsApp unlinks
              Konva and you scan a new code. Your phone does not need to be on for day-to-day use.
            </p>
          </>} />
          <SettingsHeading level={3} title="The Risk" description={<>
            <p>
              Konva uses WhatsApp Web&apos;s protocol through an unofficial library. WhatsApp does not allow unofficial clients and can ban a
              number that uses one. To keep the risk low, Konva never sends anything on its own, never shows you as online, and only sends what
              you write.
            </p>
          </>} />
          <SettingsHeading level={3} title="Read Receipts" description={<>
            <p>
              Blue ticks are sent only when you open a chat here, and only while WhatsApp Read Receipts is on in{" "}
              <Link href="/settings/notifications" className="underline underline-offset-2">Notifications</Link>.
            </p>
          </>} />
          <SettingsHeading level={3} title="Groups" description={<>
            <p>Group chats are imported, but AI triage is off for them unless you turn it on.</p>
          </>} />
          <SettingsHeading level={3} title="Unlinking" description={<>
            <p>
              Remove the linked device on your phone under Linked Devices. Pause Sync in Connected Accounts only stops syncing and keeps the link.
            </p>
          </>} />
        </SettingsSection>
      </div>}
    </>
  );
}
