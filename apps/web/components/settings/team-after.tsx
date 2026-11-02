"use client";

// Groups the company voice, cover and compliance export sections of Settings, Team into one block.

import { ChevronRight } from "lucide-react";
import type { TeamState } from "@/lib/team";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { CoverSection } from "@/components/settings/team-cover";

/**
 * What step 6 of Teams adds to Settings, Team: the company voice (everyone reads it, an owner or admin edits it), cover (each
 * person sets their own, an owner or admin anyone's) and the log of compliance exports.
 */
export function TeamAfterSection({ team, userId }: { team: TeamState; userId: string }) {
  const manages = team.role === "owner" || team.role === "admin";
  const compliance = team.role === "compliance" && !!team.workspace?.strictSharing;
  return (
    <>
      <SettingsSection id="voice" title="Company Voice" description="How the business writes, its templates and its facts. Used in work chats only, never in a personal chat.">
        <SettingsRows>
          <SettingsRow
            title="Company Voice"
            description={manages ? "Tone, sign-off, what to always and never say, templates for the reply box and facts such as prices and office hours." : "What the business has told the AI, and the templates you can insert into a reply."}
            href="/settings/team/voice"
          >
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </SettingsRow>
        </SettingsRows>
      </SettingsSection>

      <CoverSection team={team} userId={userId} />

      {(manages || compliance) && (
        <SettingsSection id="export-log" title="Records" description="Exports of a client's work history, for the files a regulated firm keeps.">
          <SettingsRows>
            <SettingsRow title="Compliance Exports" description="Who exported which client, and when. Never any text." href="/settings/team/exports">
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </SettingsRow>
          </SettingsRows>
        </SettingsSection>
      )}
    </>
  );
}
