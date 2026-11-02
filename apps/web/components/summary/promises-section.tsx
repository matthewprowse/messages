"use client";

// The Summary's Promises section: yours due within two days or late, and theirs that have passed their day, each with
// Done and Snooze. Draws nothing when there are none, so a quiet day shows no empty band. The rules are in lib/commitments.ts.

import { useMemo } from "react";
import { useApp } from "@/lib/store";
import { promisesForSummary } from "@/lib/commitments";
import { useCommitments } from "@/components/commitments/use-commitments";
import { PromiseRow } from "@/components/commitments/promise-row";
import { Section, Separated } from "@/components/summary/section";

export function PromisesSection({ headerHeight, now, base }: { headerHeight: number; now: Date; base: string }) {
  const { all, done, snooze } = useCommitments();
  const { threadById, contactById } = useApp();
  const { yours, theirs } = useMemo(() => promisesForSummary(all, now), [all, now]);
  const list = [...yours, ...theirs];
  if (list.length === 0) return null;
  const whoOf = (threadId: string, mine: boolean) => {
    if (mine) return "You";
    const t = threadById(threadId);
    return (t?.isGroup ? t.groupName : contactById(t?.participantIds[0] ?? "")?.name) || "They";
  };
  return (
    <Section title="Promises" count={list.length} headerHeight={headerHeight}>
      <Separated>
        {list.map((c) => <PromiseRow key={c.id} promise={c} who={whoOf(c.threadId, c.owner === "me")} now={now} href={`${base}/${c.threadId}`} onDone={done} onSnooze={snooze} />)}
      </Separated>
    </Section>
  );
}
