"use client";

import { Command, SetupSteps, type SetupStep } from "../setup-steps";

const STEPS: SetupStep[] = [
  {
    title: "Register an App",
    body: (
      <p>
        At entra.microsoft.com, open App Registrations and choose New Registration. Name it Messages. Under Supported Account Types, choose
        Accounts in Any Organizational Directory and Personal Microsoft Accounts.
      </p>
    ),
  },
  {
    title: "Add the Redirect Address",
    body: (
      <p>
        Still on the registration form, under Redirect URI, choose Public Client/Native (Mobile and Desktop) and enter http://localhost. Then
        choose Register. No client secret is needed.
      </p>
    ),
  },
  {
    title: "Copy the Client ID",
    body: <p>On the app&apos;s Overview, copy the Application (Client) ID into apps/worker/.env as MICROSOFT_CLIENT_ID.</p>,
  },
  {
    title: "List the Permissions",
    body: (
      <p>
        Under API Permissions, add these Microsoft Graph delegated permissions: Mail.ReadWrite, Mail.Send, Calendars.Read, User.Read and
        offline_access. For Microsoft Teams, also add Chat.ReadWrite, OnlineMeetings.Read and OnlineMeetingTranscript.Read.All. For
        Microsoft To Do, add Tasks.ReadWrite. This documents what the app asks for; you agree to them when you sign in.
      </p>
    ),
  },
  {
    title: "Ask Your IT Admin About Teams",
    body: (
      <>
        <p>
          Teams needs a work or school account. Many organisations only let an IT admin approve Teams permissions, transcripts above all. If
          Microsoft says it needs admin approval, the connect command prints a link your admin can open to approve Messages for everyone.
          They can also do it in entra.microsoft.com under Enterprise Applications, Messages, Permissions, with Grant Admin Consent.
        </p>
        <p className="mt-2">Until then, answer No to Teams when connecting, and Outlook and Outlook Calendar connect as usual.</p>
      </>
    ),
  },
  {
    title: "Run the Connect Command",
    body: (
      <>
        <p>From the project folder:</p>
        <Command>pnpm connect:microsoft</Command>
        <p className="mt-2">
          It asks whether to connect Teams and its meeting transcripts, and Microsoft To Do, as well. Microsoft then opens in your browser.
          Sign in and accept the permissions.
        </p>
      </>
    ),
  },
  {
    title: "Restart the Worker",
    body: (
      <>
        <Command>pnpm worker</Command>
        <p className="mt-2">
          It reads the app from .env when it starts. Outlook then imports the last 30 days, and new mail appears within seconds. Teams chats
          from the last 30 days come in too, and new messages within about 15 seconds. A Teams meeting&apos;s transcript appears once Teams
          has written it, usually within an hour of the meeting ending. To Do lists and tasks sync every few minutes.
        </p>
      </>
    ),
  },
];

export default function MicrosoftSetup() {
  return (
    <SetupSteps
      provider="microsoft"
      title="Connect Microsoft"
      description="Outlook, Outlook Calendar and, if you choose, Microsoft Teams and Microsoft To Do connect with one Microsoft sign-in from your terminal, for Microsoft 365 work accounts and Outlook.com alike. The sign-in is stored encrypted and never passes through the app."
      steps={STEPS}
      label="Microsoft"
      watch={["outlook", "outlook_calendar", "teams", "microsoft_todo"]}
    />
  );
}
