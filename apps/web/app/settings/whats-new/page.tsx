"use client";

// Settings, What's New: every published release, newest first, each a card with its version and date in the title row. Read
// only; the database hands back published rows only. Opening it marks the newest release seen, which takes the dot off its row
// in the Settings list and keeps the What's New dialog from opening for it.

import { useEffect } from "react";
import { Megaphone } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { dayLabel } from "@/lib/updates-model";
import { markWhatsNewSeen } from "@/lib/updates-reader";
import { latestUpdate, seenFromMetadata, updateKey } from "@/lib/updates-seen";
import { EmptyState } from "@/components/primitives";
import { Card } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPage } from "@/components/settings/settings-page";
import { WhatsNewEntry } from "@/components/whats-new/whats-new-entry";
import { usePublishedUpdates } from "@/components/whats-new/use-whats-new";

export default function WhatsNewPage() {
  const { session } = useAuth();
  const { updates, reload } = usePublishedUpdates();
  const latest = updates ? latestUpdate(updates) : undefined;
  const seen = seenFromMetadata(session?.user.user_metadata);
  useEffect(() => {
    if (latest && seen !== updateKey(latest)) void markWhatsNewSeen(latest).catch(() => {});
  }, [latest, seen]);

  return (
    <SettingsPage title="What's New">
      {updates === undefined && <><Skeleton className="h-32 w-full rounded-lg" /><Skeleton className="h-32 w-full rounded-lg" /></>}
      {updates === null && <EmptyState icon={Megaphone} title="Could Not Load Updates" description="Check your connection and try again." action={<Button variant="secondary" onClick={reload}>Retry</Button>} />}
      {updates?.length === 0 && <EmptyState icon={Megaphone} title="Nothing Yet" />}
      {updates?.map((u) => (
        <Card key={u.id} title={[u.version, dayLabel(u.releasedOn)].filter(Boolean).join(", ")}>
          <div className="px-3 pb-3"><WhatsNewEntry update={u} /></div>
        </Card>
      ))}
    </SettingsPage>
  );
}
