"use client";

// The share history in Settings, What You Share: who covered a person's work chats, which of their chats were exported, and
// which an owner or admin gave themselves access to (thread_assignment_log), by day.

import { useCover, coverState, lastDay } from "@/lib/team-cover";
import { useAuth } from "@/lib/auth";
import { useExportedChats } from "@/lib/compliance-export";
import { useTeam } from "@/lib/team";
import { useAssignmentLog } from "@/lib/assignment-log";
import { noticesFor } from "@/lib/assignment-notices";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

const day = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * More of what the agent is told in What You Share: who covered their work chats and when, and which of their chats were part
 * of a client export, by day. Nothing here shows what was read, only that it was. labels maps a chat to who it is with.
 */
export function ShareHistory({ labels }: { labels: Map<string, string> | undefined }) {
  const { periods } = useCover();
  const { state } = useTeam();
  const exported = useExportedChats();
  const log = useAssignmentLog();
  const me = useAuth().session?.user.id;
  const nameOf = (id: string) => state?.people.find((p) => p.userId === id)?.name || state?.people.find((p) => p.userId === id)?.email || "A former member";
  const covered = (periods ?? []).filter((p) => p.absentId === me);
  const exports = [...(exported?.entries() ?? [])].flatMap(([thread, days]) => days.map((d) => ({ thread, day: d }))).sort((a, b) => b.day.localeCompare(a.day));
  const taken = me && log && state ? noticesFor(log, me, (id) => state.people.find((p) => p.userId === id)?.role) : [];
  if (!covered.length && !exports.length && !taken.length) return null;
  return (
    <>
      {covered.length > 0 && (
        <SettingsSection level={3} title="Covered for You">
          <SettingsRows>
            {covered.map((p) => {
              const state_ = coverState(p);
              return (
                <SettingsRow
                  key={p.id}
                  title={`${nameOf(p.coverId)} covered for you`}
                  description={`${day(p.startsAt)} to ${day(lastDay(p))}${state_ === "active" ? ", now" : state_ === "upcoming" ? ", starts later" : state_ === "ended_early" ? ", ended early" : ""}`}
                />
              );
            })}
          </SettingsRows>
        </SettingsSection>
      )}
      {taken.length > 0 && (
        <SettingsSection level={3} title="Access Taken">
          <SettingsRows>
            {taken.slice(0, 20).map((e) => (
              <SettingsRow
                key={e.id}
                title={`${nameOf(e.assigneeId)} gave themselves access`}
                description={`${e.agentId === me ? labels?.get(e.threadId) || "Your chat" : "A chat assigned to you"}, ${day(e.assignedAt)}`}
              />
            ))}
          </SettingsRows>
        </SettingsSection>
      )}
      {exports.length > 0 && (
        <SettingsSection level={3} title="Included in Exports">
          <SettingsRows>
            {exports.slice(0, 20).map((e) => (
              <SettingsRow key={`${e.thread}-${e.day}`} title={labels?.get(e.thread) || "Chat"} description={`Included in an export on ${day(e.day)}`} />
            ))}
          </SettingsRows>
        </SettingsSection>
      )}
    </>
  );
}
