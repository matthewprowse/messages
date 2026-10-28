"use client";

// The owner's block in Settings, Team: work chats, response times and shared inboxes.

import { ChevronRight } from "lucide-react";
import type { TeamState } from "@/lib/team";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";
import { SharedInboxesSection } from "@/components/settings/team-inboxes";

/**
 * The owner's part of Settings, Team (step 5 of Teams): where the work chats are listed and assigned, how fast clients are
 * answered, and the shared inboxes. Compliance gets the work chats while strict sharing is on, and nothing else.
 */
export function TeamOwnerSection({ team }: { team: TeamState }) {
  const manages = team.role === "owner" || team.role === "admin";
  const compliance = team.role === "compliance" && !!team.workspace?.strictSharing;
  return (
    <>
      {(manages || compliance) && (
        <SettingsSection
          id="oversight"
          title={manages ? "Clients and Activity" : "Work Chats"}
          description={manages ? "Find a client and give their chats to someone, and see how fast the team answers. Counts and times only: you read a chat only once it is assigned to you." : "Read the team's work chats. The agent whose chat it is can see that you opened it."}
        >
          <SettingsRows>
            <SettingsRow title="Work Chats" description={manages ? "Every shared chat with who looks after it. Assign one to read it, or reassign everything from someone who has left." : "Every shared chat. Opening one is logged."} href="/settings/team/work-chats">
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </SettingsRow>
            {manages && (
              <SettingsRow title="Activity" description="Unanswered work chats, reply times and chats moved back to personal." href="/settings/team/activity">
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </SettingsRow>
            )}
          </SettingsRows>
        </SettingsSection>
      )}
      <SharedInboxesSection team={team} />
    </>
  );
}
