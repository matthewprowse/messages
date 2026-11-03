"use client";

// Settings page for connecting any IMAP and SMTP mailbox: the in-app form in SetupSteps, with the user's own address passed on.

import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { ImapConnectForm } from "@/components/imap-connect";
import { SetupSteps } from "../setup-steps";

export default function ImapSetup() {
  const { session } = useAuth();
  const email = session?.user.email ?? "";
  return (
    <SetupSteps
      provider="imap"
      title="Connect Other Email"
      label="Email"
      watch={["imap"]}
      connect={
        <div className="max-w-sm">
          <ImapConnectForm
            defaultEmail={/@(gmail|googlemail|icloud|me|mac)\.com$/i.test(email) ? "" : email}
            onConnected={({ label }) => toast(label === "Email" ? "Your email is connected." : `${label} is connected.`)}
          />
        </div>
      }
    />
  );
}
