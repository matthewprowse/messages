"use client";

// The meeting brief in a calendar event's details: one block per guest you know, built by the AI worker 30 minutes
// before the start from summaries already stored. Nothing is shown for an event with no brief.

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadEventPrep } from "@/lib/prep";
import type { PrepPerson } from "@/lib/prep-text";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}

function PersonBrief({ p }: { p: PrepPerson }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-col">
        {p.contactId ? <Link href={`/contacts/${p.contactId}`} className="text-sm font-medium underline-offset-2 hover:underline">{p.name}</Link> : <span className="text-sm font-medium">{p.name}</span>}
        {p.who && <span className="text-xs text-muted-foreground">{p.who}</span>}
      </div>
      {p.asked && <List title="They Asked For" items={[p.asked]} />}
      <List title="Open Promises" items={p.promises} />
      <List title="Last Conversations" items={p.recent} />
      {p.lastMeeting && <List title="Last Meeting" items={[p.lastMeeting]} />}
    </div>
  );
}

/** The brief for an event, under its details. id="prep" is where the Summary's Prep link lands. */
export function EventPrep({ eventId }: { eventId: string | null }) {
  const [people, setPeople] = useState<PrepPerson[]>([]);
  useEffect(() => {
    setPeople([]);
    if (!eventId) return;
    let live = true;
    loadEventPrep(eventId).then((p) => { if (live) setPeople(p); }, () => undefined);
    return () => { live = false; };
  }, [eventId]);
  if (people.length === 0) return null;
  return (
    <section id="prep" className="flex flex-col gap-2" aria-label="Meeting prep">
      <h3 className="text-sm font-medium">Prep</h3>
      {people.map((p) => <PersonBrief key={p.contactId || p.name} p={p} />)}
    </section>
  );
}
