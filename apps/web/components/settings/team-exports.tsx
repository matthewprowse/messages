"use client";

// Settings, Team, Compliance Exports: the log of client work history exports, with counts and never message text.

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { relTime } from "@/lib/format";
import { useExportLog } from "@/lib/compliance-export";
import type { TeamState } from "@/lib/team";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Settings, Team, Compliance Exports: the log of client work history exports. Who exported which client, when, and how many
 * chats and messages. Never a word of any chat. An owner or admin sees all of it, Compliance its own.
 */
export function ExportLogSection({ team }: { team: TeamState }) {
  const manages = team.role === "owner" || team.role === "admin";
  const { rows, reload } = useExportLog(true);
  return (
    <SettingsSection
      id="exports"
      title="Compliance Exports"
      description={manages
        ? "Each time someone exports a client's work history it is recorded here, and the agent whose chat is included is told. To export, open the client in Contacts, Team Clients. Exports need strict sharing to be on."
        : "The exports you have made. To export a client's work history, open the client in Contacts, Team Clients."}
    >
      {rows === undefined ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : rows === null ? (
        <Alert variant="destructive">
          <AlertTitle>Could Not Load the Log</AlertTitle>
          <AlertDescription>
            <p>Check your connection and try again.</p>
            <button type="button" className="mt-2 underline underline-offset-4" onClick={() => void reload()}>Retry</button>
          </AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <SettingsEmpty>No export has been made yet.</SettingsEmpty>
      ) : (
        <SettingsRows>
          {rows.map((r) => (
            <SettingsRow
              key={r.id}
              title={r.client}
              description={[
                `Exported by ${r.userName}`,
                `${day(r.startedAt)}, ${relTime(r.startedAt)}`,
                `${r.chats} ${r.chats === 1 ? "chat" : "chats"}`,
                r.messages === null ? (r.finished ? "No messages" : "Not finished") : `${r.messages} ${r.messages === 1 ? "message" : "messages"}`,
              ].join(", ")}
            />
          ))}
        </SettingsRows>
      )}
    </SettingsSection>
  );
}
