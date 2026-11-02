"use client";

// 3. What Konva has so far: the real counts from your accounts, an About You started from your own words, and the
// people you talk to most (from your real conversations). How you write is shown as an example only: Konva learns
// it from replies it has read, and nothing on this step is saved unless it came from you or from your real data.

import { useEffect, useState } from "react";
import { Mail, MessagesSquare, Sparkles, Users, X } from "lucide-react";
import { aboutSeed, keepPatch, topPeople, type Person } from "@/lib/onboarding-findings";
import { useApp } from "@/lib/store";
import { BrandLogo } from "@/components/provider-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StepFrame, useSetup } from "./setup-context";

/** Shown under How You Write: a sample of the kind of note Konva will keep, not a finding about this person. */
const WRITING_EXAMPLE = "Short and friendly. You open with the person's first name, keep most replies to two or three sentences, and sign off with just your first name.";

export function LearnedStep() {
  const { next, back, busy, imported, channels, role, extra } = useSetup();
  const { profile, dispatch, threads, contacts } = useApp();
  const [about, setAbout] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const ready = imported.done;

  // Filled once the import is in: About You from what you said, the people from your real conversations.
  useEffect(() => {
    if (!ready) return;
    setAbout((a) => a || aboutSeed(role, extra));
    setPeople((p) => (p.length ? p : topPeople(threads, contacts)));
  }, [ready, role, extra, threads, contacts]);

  const keep = () => {
    const patch = keepPatch(profile, about, people);
    if (Object.keys(patch).length > 0) dispatch({ type: "patchProfile", patch });
    next();
  };

  const { counts } = imported;
  return (
    <StepFrame
      title={ready ? "Here's What Konva Has" : "Reading Your Messages"}
      description={ready
        ? "These are the real numbers from your accounts. Edit what Konva will know about you; it's used to sort and draft for you."
        : "Konva is bringing in your messages. This takes a moment."}
      footer={
        <>
          {back && <Button variant="ghost" disabled={busy} onClick={back}>Back</Button>}
          {!ready && <Button variant="ghost" disabled={busy} onClick={next}>Skip</Button>}
          <Button disabled={busy || !ready} onClick={keep}>{ready ? "Looks Right" : "Reading…"}</Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={<Mail className="size-4" />} label="Email Conversations" value={counts.emailConversations} off={!channels.mail} />
          <Stat icon={<BrandLogo brand="whatsapp" />} label="WhatsApp Chats" value={counts.whatsappConversations} off={!channels.whatsapp} />
          <Stat icon={<MessagesSquare className="size-4" />} label="Conversations" value={counts.conversations} />
          <Stat icon={<Users className="size-4" />} label="Contacts" value={counts.contacts} />
        </div>

        <Written title="About You" note="Start from your own words." ready={ready}>
          <div className="rounded-lg border">
            <Textarea
              aria-label="About You"
              rows={4}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="What you do and who you talk to. You can also add this later in Settings, under Personalisation."
              className="resize-none rounded-none border-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
        </Written>

        <Written title="How You Write" note="Learned from replies you send." ready={ready} example>
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">{WRITING_EXAMPLE}</p>
          <p className="text-xs text-muted-foreground">An example of what Konva keeps. Yours appears in Settings, under Personalisation, once Konva has read your sent replies. Nothing here is saved.</p>
        </Written>

        <Written title="Who Matters Most" note="The people you talk to most." ready={ready}>
          <People people={people} onChange={setPeople} />
        </Written>
      </div>
    </StepFrame>
  );
}

function Stat({ icon, label, value, off }: { icon: React.ReactNode; label: string; value: number; off?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}<span className="truncate">{label}</span></div>
      <div className="mt-1 text-xl font-medium tabular-nums">{off ? "None" : value.toLocaleString()}</div>
    </div>
  );
}

/** One section, waiting as a skeleton until the import is in. An example is labelled as one. */
function Written({ title, note, ready, example, children }: { title: string; note: string; ready: boolean; example?: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-3.5 text-muted-foreground" /> {title} {example && <Badge variant="outline">Example</Badge>}
        </h3>
        {ready && <span className="truncate text-xs text-muted-foreground">{note}</span>}
      </div>
      {ready ? children : (
        <div className="space-y-2 rounded-lg border p-3">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}
    </section>
  );
}

function People({ people, onChange }: { people: Person[]; onChange: (p: Person[]) => void }) {
  const [name, setName] = useState("");
  const [why, setWhy] = useState("");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onChange([...people, { name: name.trim(), why: why.trim() }]);
    setName("");
    setWhy("");
  };
  return (
    <div className="divide-y rounded-lg border">
      {people.map((p) => (
        <div key={p.name} className="flex items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{p.name}</div>
            {p.why && <div className="truncate text-xs text-muted-foreground">{p.why}</div>}
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.name}`} onClick={() => onChange(people.filter((x) => x !== p))}><X /></Button>
        </div>
      ))}
      <form onSubmit={add} className="flex flex-wrap items-center gap-2 p-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" className="h-8 min-w-32 flex-1" />
        <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Who They Are to You" aria-label="Who they are to you" className="h-8 min-w-40 flex-[2]" />
        <Button type="submit" variant="secondary" size="sm" disabled={!name.trim()}>Add</Button>
      </form>
    </div>
  );
}
