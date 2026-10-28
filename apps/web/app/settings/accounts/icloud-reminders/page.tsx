"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsHeading, SettingsSection } from "@/components/settings/sections";
import { ICloudRemindersConnect } from "@/components/icloud-reminders-connect";

export default function ICloudRemindersSetup() {
  useEffect(() => { track("account_connect", { provider: "icloud_reminders", step: "setup", outcome: "start" }); }, []);
  return (
    <>
      <SettingsHeader
        title="Connect iCloud Reminders"
        description="Konva signs in to iCloud on your behalf, the way icloud.com does, so your reminders show in Calendar and the Summary on the day they are due. There is nothing to install."
        back="/settings/accounts"
      />

      <ICloudRemindersConnect />

      <div className="mt-8">
        <SettingsSection id="before-you-connect" title="Before You Connect">
          <SettingsHeading level={3} title="Signing In to iCloud for You" description={<>
            <p>
              You type your Apple ID and password here, and Konva signs in to iCloud on your behalf. Konva only reads and updates your
              Reminders. It does not open your email, photos, files or anything else in iCloud.
            </p>
          </>} />
          <SettingsHeading level={3} title="Your Password" description={<>
            <p>
              Your password is used once, to sign in, and is not kept. Konva keeps the session Apple gives it, encrypted, so it can keep
              reading your Reminders.
            </p>
          </>} />
          <SettingsHeading level={3} title="Signing In Again" description={<>
            <p>
              Apple ends a session like this after a while, so you may need to sign in again about once a month. When that happens,
              Connected Accounts shows Reconnect next to iCloud Reminders and brings you back to this page. Changing your Apple ID
              password also ends the session.
            </p>
          </>} />
          <SettingsHeading level={3} title="The Code From Apple" description={<>
            <p>
              Apple asks for a 6-digit code to confirm it is you. It appears on an Apple device that is signed in to the same Apple ID.
              Type it here. If you would rather get it by text message, choose Send a Text Instead.
            </p>
          </>} />
          <SettingsHeading level={3} title="Advanced Data Protection" description={<>
            <p>
              If you have Advanced Data Protection turned on, Apple keeps Reminders closed to the web until you allow it. On your iPhone,
              open Settings, tap your name, then iCloud, and turn on Access iCloud Data on the Web. Then choose Continue here and approve
              the prompt that appears on your device.
            </p>
          </>} />
          <SettingsHeading level={3} title="What Syncs" description={<>
            <p>
              Open reminders, and ones completed in the last 30 days, from every list: the title, notes, due date or time, priority and
              list. New and changed reminders reach Konva within a few minutes. Ticking one off or back on in Konva does the same in
              Reminders, and iCloud passes it to your other devices. Nothing else is ever changed.
            </p>
          </>} />
        </SettingsSection>
      </div>
    </>
  );
}
