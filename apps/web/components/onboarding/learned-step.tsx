"use client";

import { useEffect, useState } from "react";
import { Mail, MessagesSquare, Sparkles, Users, X } from "lucide-react";
import { MOCK_PEOPLE, MOCK_WRITING, mockAbout, mockRefine, peopleText, type Person } from "@/lib/onboarding-demo";
import { useApp } from "@/lib/store";
import { BrandLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StepFrame, useSetup } from "./setup-context";

// 3. What Konva found: how much came in, and the profile it wrote from it, to read, edit and refine
// before it is used. Kept only when you continue, and only into settings you have not filled in yourself.

export function LearnedStep() {
  const { next, back, busy, imported, channels, role, extra } = useSetup();
  const { profile, dispatch } = useApp();
  const [about, setAbout] = useState("");
  const [writing, setWriting] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const ready = imported.done;

  // Written once the import is in, from the import and what you said about yourself.
  useEffect(() => {
    if (!ready) return;
    setAbout((a) => a || mockAbout(role, extra));
    setWriting((w) => w || MOCK_WRITING);
    setPeople((p) => (p.length ? p : MOCK_PEOPLE));
  }, [ready, role, extra]);

  const keep = () => {
    const patch = {
      ...(!profile.about.trim() && about.trim() ? { about: about.trim() } : {}),
      ...(!profile.people.trim() && people.length ? { people: peopleText(people) } : {}),
    };
    if (Object.keys(patch).length > 0) dispatch({ type: "patchProfile", patch });
    next();
  };

  const { counts } = imported;
  return (
    <StepFrame
      title={ready ? "Here's What Konva Found" : "Reading Your Messages"}
      description={ready
        ? "Konva wrote this from your messages. Edit anything, or tell it what to change. It's used to sort and draft for you."
        : "Konva is bringing in your messages and learning how you work. This takes a moment."}
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
          <Stat icon={<Mail className="size-4" />} label="Emails" value={counts.emails} off={!channels.mail} />
          <Stat icon={<BrandLogo brand="whatsapp" />} label="WhatsApp Messages" value={counts.whatsapp} off={!channels.whatsapp} />
          <Stat icon={<MessagesSquare className="size-4" />} label="Conversations" value={counts.conversations} />
          <Stat icon={<Users className="size-4" />} label="Contacts" value={counts.contacts} />
        </div>

        <Written title="About You" note="From your role and the conversations you have most." ready={ready}>
          <Editable value={about} onChange={setAbout} label="About You" rows={4} />
        </Written>

        <Written title="How You Write" note={`From ${Math.min(counts.emails, 200).toLocaleString()} replies you sent.`} ready={ready}>
          <Editable value={writing} onChange={setWriting} label="How You Write" rows={4} />
        </Written>

        <Written title="Who Matters Most" note="The people you reply to fastest and most often." ready={ready}>
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

/** One thing Konva wrote, waiting as a skeleton until the import is in. */
function Written({ title, note, ready, children }: { title: string; note: string; ready: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="size-3.5 text-muted-foreground" /> {title}</h3>
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

/** Text to edit directly, or to change by saying how. */
function Editable({ value, onChange, label, rows }: { value: string; onChange: (v: string) => void; label: string; rows: number }) {
  const [ask, setAsk] = useState("");
  const [thinking, setThinking] = useState(false);
  const change = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ask.trim()) return;
    setThinking(true);
    // MOCK: the AI worker rewrites it with the instruction.
    setTimeout(() => { onChange(mockRefine(value, ask)); setAsk(""); setThinking(false); }, 900);
  };
  return (
    <div className="rounded-lg border">
      <Textarea
        aria-label={label}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={thinking}
        className="resize-none rounded-none border-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <form onSubmit={change} className="flex items-center gap-2 border-t p-2">
        <Input value={ask} onChange={(e) => setAsk(e.target.value)} disabled={thinking} placeholder="Tell Konva What to Change" aria-label={`Change ${label}`} className="h-8 flex-1" />
        <Button type="submit" variant="secondary" size="sm" disabled={thinking || !ask.trim()}>{thinking ? "Changing…" : "Change"}</Button>
      </form>
    </div>
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
