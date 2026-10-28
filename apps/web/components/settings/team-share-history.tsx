"use client";

import { useCover, coverState, lastDay } from "@/lib/team-cover";
import { useAuth } from "@/lib/auth";
import { useExportedChats } from "@/lib/compliance-export";
import { useTeam } from "@/lib/team";
import { SettingsHeading, SettingsRow, SettingsRows } from "@/components/settings/sections";

const day = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * More of what the agent is told in What You Share: who covered their work chats and when, and which of their chats were part
 * of a client export, by day. Nothing here shows what was read, only that it was. labels maps a chat to who it is with.
 */
export function ShareHistory({ labels }: { labels: Map<string, string> | undefined }) {
  const { periods } = useCover();
  const { state } = useTeam();
  const exported = useExportedChats();
  const me = useAuth().session?.user.id;
  const nameOf = (id: string) => state?.people.find((p) => p.userId === id)?.name || state?.people.find((p) => p.userId === id)?.email || "A former member";
  const covered = (periods ?? []).filter((p) => p.absentId === me);
  const exports = [...(exported?.entries() ?? [])].flatMap(([thread, days]) => days.map((d) => ({ thread, day: d }))).sort((a, b) => b.day.localeCompare(a.day));
  if (!covered.length && !exports.length) return null;
  return (
    <div className="space-y-4">
      {covered.length > 0 && (
        <div className="space-y-2">
          <SettingsHeading level={3} title="Cover" description="Colleagues who read your work chats while you were away." />
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
        </div>
      )}
      {exports.length > 0 && (
        <div className="space-y-2">
          <SettingsHeading level={3} title="Included in Exports" description="Chats of yours that were part of a client work history export for the team's records." />
          <SettingsRows>
            {exports.slice(0, 20).map((e) => (
              <SettingsRow key={`${e.thread}-${e.day}`} title={labels?.get(e.thread) || "Chat"} description={`Included in an export on ${day(e.day)}`} />
            ))}
          </SettingsRows>
        </div>
      )}
    </div>
  );
}
