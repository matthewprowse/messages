"use client";

// Settings, What You Share: the chats shared with the team, who each is assigned to, and moving one back to personal.

import { useState } from "react";
import Link from "next/link";
import { useSharedChats, type SharedChat } from "@/lib/share";
import type { TeamRole } from "@/lib/team";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MovePersonalDialog } from "@/components/share-dialog";
import { SettingsBody, SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { ShareHistory } from "@/components/settings/team-share-history";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const CHANNEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn", instagram: "Instagram", teams: "Teams", zoom: "Zoom", google_chat: "Google Chat" };
const BY: Record<string, string> = { agent: "by you", rule: "by a team rule", suggestion: "from a suggestion", account: "as part of a shared account" };

/** The chats you share with the team, who each is assigned to, and a way to move one back to personal. */
export function SharedChatsSection({ strict, role }: { strict: boolean; role: TeamRole | null }) {
  const { chats, failed, load } = useSharedChats();
  const [moving, setMoving] = useState<SharedChat | null>(null);
  // Under strict sharing a work chat stays shared until an owner or admin releases it.
  const canMove = !strict || role === "owner" || role === "admin";

  return (
    <SettingsSection id="shared" title="What You Share">
      {failed && !chats ? (
        <SettingsBody>
          <Alert variant="destructive">
            <AlertTitle>Could Not Load Your Shared Chats</AlertTitle>
            <AlertDescription>
              <p>Check your connection and try again.</p>
              <Button variant="secondary" className="mt-2" onClick={() => void load()}>Retry</Button>
            </AlertDescription>
          </Alert>
        </SettingsBody>
      ) : !chats ? (
        <SettingsBody><Skeleton className="h-20 w-full rounded-lg" /></SettingsBody>
      ) : chats.length === 0 ? (
        <SettingsEmpty>Nothing is shared yet.</SettingsEmpty>
      ) : (
        <SettingsRows>
          {chats.map((c) => (
            <SettingsRow
              key={c.threadId}
              title={
                <>
                  <Link href={`/inbox/${c.threadId}`} className="underline-offset-2 hover:underline">{c.label || "Chat"}</Link>
                  {c.state === "sharing" && <Badge variant="secondary">Sharing</Badge>}
                  {c.state === "failed" && <Badge variant="destructive">Sharing Failed</Badge>}
                </>
              }
              description={[
                CHANNEL[c.channel] ?? c.channel,
                `Shared ${day(c.sharedAt)} ${BY[c.sharedBy] ?? ""}`.trim(),
                c.shareFrom ? `From ${day(c.shareFrom)}` : "Whole history",
                c.assignees.length ? `Assigned to ${c.assignees.map((a) => a.name).join(", ")}` : "Not assigned to anyone",
                ...c.complianceOpens.map((d) => `Opened by Compliance on ${day(d)}`),
              ].join(", ")}
            >
              {c.sharedBy !== "account" && (
                <Button variant="secondary" disabled={!canMove} title={canMove ? undefined : "Strict sharing keeps work chats shared. Only an owner or admin can release one."} onClick={() => setMoving(c)}>
                  Move to Personal
                </Button>
              )}
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      <ShareHistory labels={chats ? new Map(chats.map((c) => [c.threadId, c.label])) : undefined} />
      {moving && <MovePersonalDialog threadId={moving.threadId} open onOpenChange={(open) => !open && setMoving(null)} onDone={() => void load()} />}
    </SettingsSection>
  );
}
