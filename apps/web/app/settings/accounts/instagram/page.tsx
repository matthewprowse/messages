"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsHeading, SettingsSection } from "@/components/settings/sections";
import { InstagramConnect } from "@/components/instagram-connect";
import { Command } from "../setup-steps";

export default function InstagramSetup() {
  useEffect(() => { track("account_connect", { provider: "instagram", step: "setup", outcome: "start" }); }, []);
  return (
    <>
      <SettingsHeader
        title="Connect Instagram"
        description="Konva signs in to your Instagram account to bring your direct messages into Conversations. Personal, Business and Creator accounts all work."
        back="/settings/accounts"
      />

      <InstagramConnect />

      <div className="mt-8">
        <SettingsSection id="before-you-connect" title="Before You Connect">
          <SettingsHeading level={3} title="The Risk" description={<>
            <p>
              Konva uses Instagram&apos;s mobile app protocol through an unofficial library. Instagram does not allow unofficial clients and can
              ask you to confirm it is you, limit the account for a while, or in rare cases disable it. To keep the risk low, Konva checks for
              new messages every few minutes rather than all the time, slows down whenever Instagram asks, and never sends anything on its own.
            </p>
          </>} />
          <SettingsHeading level={3} title="Codes From Instagram" description={<>
            <p>
              Instagram may email or text you a code when Konva signs in, or ask for your two-factor code. Enter it on this page. If Instagram
              later asks to confirm it is you, Konva stops and shows why here. Confirm it in the Instagram app, then connect again.
            </p>
          </>} />
          <SettingsHeading level={3} title="Seen" description={<>
            <p>People only see that you read their message once you open the conversation in Konva.</p>
          </>} />
          <SettingsHeading level={3} title="What Comes Across" description={<>
            <p>
              Text, photos, videos and voice notes, with shared posts and reels as links. Disappearing photos and videos stay in Instagram.
              Replies from Konva are text only for now. Message requests stay in Instagram until you accept them there.
            </p>
          </>} />
          <SettingsHeading level={3} title="Keep the Connector Running" description={<>
            <p>From the project folder, once:</p>
            <Command>pip3 install -r apps/ai/requirements-instagram.txt</Command>
            <p className="mt-2">Then keep it running:</p>
            <Command>pnpm instagram</Command>
          </>} />
        </SettingsSection>
      </div>
    </>
  );
}
