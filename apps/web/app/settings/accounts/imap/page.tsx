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
      description="Any mailbox with IMAP and SMTP, like mail on your own domain at Afrihost, xneelo, Domains.co.za or a cPanel host. The password is checked with your mail server and stored encrypted."
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
