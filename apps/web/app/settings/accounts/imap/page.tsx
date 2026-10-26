"use client";

import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { ImapConnectForm } from "@/components/imap-connect";
import { Command, SetupSteps, type SetupStep } from "../setup-steps";

const STEPS: SetupStep[] = [
  { title: "Have Your Email Password Ready", body: "The one your email app uses. Yahoo, Fastmail and Zoho with two-factor sign-in need an app password instead." },
  { title: "Run the Connect Command", body: <><p>From the project folder. It finds the server settings, or lets you type them in:</p><Command>pnpm connect:imap</Command></> },
  { title: "Keep the Worker Running", body: <><Command>pnpm worker</Command><p className="mt-2">New mail then appears in Conversations within seconds.</p></> },
];

export default function ImapSetup() {
  const { session } = useAuth();
  const email = session?.user.email ?? "";
  return (
    <SetupSteps
      provider="imap"
      title="Connect Other Email"
      description="Any mailbox with IMAP and SMTP, like mail on your own domain at Afrihost, xneelo, Domains.co.za or a cPanel host. The password is checked with your mail server and stored encrypted."
      steps={STEPS}
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
