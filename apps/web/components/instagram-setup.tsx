"use client";

// The Instagram page under Settings, Accounts: asks which kind of account it is, then shows the matching connect flow.

import { Suspense, useState } from "react";
import { useApp } from "@/lib/store";
import { InstagramConnect } from "@/components/instagram-connect";
import { InstagramOfficial } from "@/components/instagram-official";
import { isOfficialInstagram } from "@/components/instagram-window";
import { SettingsHeading, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { Button } from "@/components/ui/button";

type Choice = "professional" | "personal" | "unsure";

/** Instagram's two kinds of account connect in two ways, so the first question is which one it is. */
function Choices({ unsure, onPick }: { unsure?: boolean; onPick: (choice: Choice) => void }) {
  return (
    <SettingsRows>
      <SettingsRow title="Business or Creator" description="Sign in on Instagram and approve Konva. There is nothing to type here.">
        <Button onClick={() => onPick("professional")}>Choose</Button>
      </SettingsRow>
      <SettingsRow title="Personal" description="Sign in with your Instagram username and password.">
        <Button variant="secondary" onClick={() => onPick("personal")}>Choose</Button>
      </SettingsRow>
      {!unsure && (
        <SettingsRow title="Not Sure" description="Check in the Instagram app. It takes a minute.">
          <Button variant="secondary" onClick={() => onPick("unsure")}>Show Me How</Button>
        </SettingsRow>
      )}
    </SettingsRows>
  );
}

function ChangeType({ onChange }: { onChange: () => void }) {
  return <Button variant="ghost" className="-ml-2.5 mb-4" onClick={onChange}>Change Account Type</Button>;
}

export function InstagramSetup() {
  const { accounts } = useApp();
  const account = accounts.find((a) => a.provider === "instagram");
  const [picked, setPicked] = useState<Choice | "choose" | null>(null);
  // An account Konva already has opens on its own kind, so its status and any problem show at once.
  const known: Choice | null = account ? (isOfficialInstagram(account) ? "professional" : "personal") : null;
  const choice = picked === "choose" ? null : picked ?? known;
  const busy = account?.status === "connected" || account?.status === "syncing" || account?.status === "connecting";

  if (choice === null) {
    return (
      <SettingsSection title="What Kind of Account Is It?" description="Instagram connects one way for Business and Creator accounts and another for Personal ones.">
        <Choices onPick={setPicked} />
      </SettingsSection>
    );
  }

  if (choice === "unsure") {
    return (
      <>
        <ChangeType onChange={() => setPicked("choose")} />
        <SettingsSection title="How to Check Your Account Type" description="It takes a minute in the Instagram app.">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Open your profile and tap the menu in the top corner.</li>
            <li>Tap Settings and Privacy, then scroll to Account Type and Tools.</li>
            <li>If it offers Switch to Professional Account, yours is Personal. If it offers Switch Account Type, yours is already Business or Creator.</li>
          </ol>
          <p className="text-sm text-muted-foreground">
            A Personal account can switch to a professional one for free, and it keeps your followers and your posts. Switching also lets Konva
            connect the official way, with no password.
          </p>
        </SettingsSection>
        <div className="mt-6">
          <SettingsHeading title="Which Is Yours?" />
          <div className="mt-3"><Choices unsure onPick={setPicked} /></div>
        </div>
      </>
    );
  }

  if (choice === "professional") {
    return (
      <>
        {!busy && <ChangeType onChange={() => setPicked("choose")} />}
        <Suspense><InstagramOfficial account={account && isOfficialInstagram(account) ? account : undefined} /></Suspense>
        <div className="mt-8 space-y-4">
          <SettingsHeading level={3} title="What Konva Does" description={<p>
            You sign in on instagram.com and approve two permissions: to see your account name, and to read and answer your messages.
            Konva never sees your password, and it only sends the replies you write.
          </p>} />
          <SettingsHeading level={3} title="Replies Within 24 Hours" description={<p>
            Instagram lets a Business or Creator account reply within 24 hours of the other person&apos;s last message. After that, the reply
            has to be sent in Instagram itself. Replies from Konva are text only for now.
          </p>} />
          <SettingsHeading level={3} title="What Comes Across" description={<p>
            Direct messages with their photos, videos and voice notes, as shared posts and reels links. Instagram only lets Konva read the 20
            newest messages of each conversation. Message requests stay in Instagram until you accept them there.
          </p>} />
        </div>
      </>
    );
  }

  return (
    <>
      {!busy && <ChangeType onChange={() => setPicked("choose")} />}
      <InstagramConnect />
      <div className="mt-8">
        <SettingsSection id="before-you-connect" title="Before You Connect">
          <SettingsHeading level={3} title="The Risk" description={<>
            <p>
              Konva uses Instagram&apos;s mobile app protocol through an unofficial library. Instagram does not allow unofficial clients and can
              ask you to confirm it is you, limit the account for a while, or in rare cases disable it. To keep the risk low, Konva checks for
              new messages every few minutes rather than all the time, slows down whenever Instagram asks, and never sends anything on its own.
            </p>
            <p className="mt-2">
              A Business or Creator account avoids this, because Instagram itself approves the connection. Switching is free and keeps your
              followers. Choose Change Account Type above to see how.
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
        </SettingsSection>
      </div>
    </>
  );
}
