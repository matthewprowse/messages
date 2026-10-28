"use client";

// 5. A practice reply, in a copy of the real reply box: tap a choice, say what to say, or write it yourself
// and let Konva tidy it, then adjust the tone. MOCK: the drafts are canned or built from what you type;
// the real ones come from the AI worker in your voice. Nothing here is ever sent.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, CircleCheck, Circle } from "lucide-react";
import { track } from "@/lib/analytics";
import { demoMessage, mockAdjust, mockFromInstruction, mockTidy, type DemoChannel, type Tone } from "@/lib/onboarding-demo";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StepFrame, useSetup } from "./setup-context";

type Way = "choice" | "said" | "own" | "adjust";

const WAYS: { way: Way; title: string; detail: string }[] = [
  { way: "choice", title: "Tap a Choice", detail: "Konva reads the message and offers the likely answers." },
  { way: "said", title: "Say What to Say", detail: "A few words, and Konva writes the full reply." },
  { way: "own", title: "Write It Yourself", detail: "Then Edit Text tidies it without changing what you said." },
  { way: "adjust", title: "Adjust the Tone", detail: "Shorter, more formal or more casual." },
];

const TONES: { key: Tone; label: string }[] = [
  { key: "shorter", label: "Shorter" },
  { key: "formal", label: "More Formal" },
  { key: "casual", label: "More Casual" },
];

export function DraftStep() {
  const { next, back, busy, firstName } = useSetup();
  const [channel, setChannel] = useState<DemoChannel>("email");
  const msg = demoMessage(channel, firstName);
  const [text, setText] = useState("");
  const [drafted, setDrafted] = useState("");
  const [said, setSaid] = useState("");
  const [phase, setPhase] = useState<"thinking" | "streaming" | null>(null);
  const [tried, setTried] = useState<Set<Way>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const switchTo = (c: DemoChannel) => { clearTimeout(timer.current); setChannel(c); setText(""); setDrafted(""); setSaid(""); setPhase(null); };

  /** Shows a reply the way a real draft arrives: a moment's thought, then the words streaming in. */
  const write = (full: string, way: Way) => {
    clearTimeout(timer.current);
    setTried((t) => new Set(t).add(way));
    track("feature_used", { feature: "onboarding_draft", detail: way });
    setPhase("thinking");
    setText("");
    let shown = 0;
    const step = () => {
      shown = Math.min(full.length, shown + 4);
      setText(full.slice(0, shown));
      if (shown < full.length) timer.current = setTimeout(step, 16);
      else { setPhase(null); setDrafted(full); }
    };
    timer.current = setTimeout(() => { setPhase("streaming"); step(); }, 700);
  };

  const own = text.trim().length > 0 && text.trim() !== drafted.trim() && !phase;
  const working = !!phase;
  const sendLabel = channel === "email" ? "Gmail" : "WhatsApp";

  return (
    <StepFrame
      title="Try a Reply"
      description="This is how replying works in Konva. Try each way on a practice message. Nothing here is sent."
      footer={
        <>
          {back && <Button variant="ghost" disabled={busy} onClick={back}>Back</Button>}
          <Button disabled={busy} onClick={next}>{tried.size > 0 ? "Continue" : "Skip"}</Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_11rem]">
        <div className="min-w-0 space-y-3">
          <Tabs value={channel} onValueChange={(v) => switchTo(v as DemoChannel)}>
            <TabsList>
              <TabsTrigger value="email"><BrandLogo brand="gmail" className="size-3.5" /> Email</TabsTrigger>
              <TabsTrigger value="whatsapp"><BrandLogo brand="whatsapp" className="size-3.5" /> WhatsApp</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Their message, as a bubble like in Conversations. */}
          <div className="max-w-[85%]">
            <div className="mb-1 text-xs text-muted-foreground">{msg.from}{msg.subject && <> · {msg.subject}</>}</div>
            <div className="rounded-lg rounded-bl-[2px] bg-muted p-3 text-sm leading-6 whitespace-pre-line">{msg.body}</div>
          </div>

          {/* The reply box, as in a conversation. */}
          <div className="space-y-3 rounded-lg border p-3">
            {!drafted && !working && (
              <div className="flex flex-wrap gap-2" aria-label="Choices">
                {msg.choices.map((c) => (
                  <Button key={c.label} variant="secondary" onClick={() => write(c.draft, "choice")}>{c.label}</Button>
                ))}
              </div>
            )}
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (said.trim()) write(mockFromInstruction(msg, channel, said, firstName), "said"); }}>
              <Input value={said} onChange={(e) => setSaid(e.target.value)} disabled={working} placeholder={drafted ? "What To Change" : "What To Say, e.g. yes, Saturday at 10"} aria-label="What To Say" className="h-8 min-w-48 flex-1" />
              <Button type="submit" variant="secondary" size="sm" disabled={working || !said.trim()}>{drafted ? "Redraft" : "Draft"}</Button>
              {text.trim() && !working && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button type="button" variant="secondary">Adjust <ChevronDown /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {TONES.map((t) => <DropdownMenuItem key={t.key} onSelect={() => write(mockAdjust(text, t.key), "adjust")}>{t.label}</DropdownMenuItem>)}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </form>
            {phase === "thinking" ? (
              <div className="flex h-24 items-start pt-1" aria-label="Drafting a reply"><Skeleton className="h-3 w-3/5" /></div>
            ) : (
              <Textarea
                value={text}
                readOnly={working}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder="Or write your own reply here"
                className="min-h-24 resize-none border-0 p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <div>{own && <Button variant="secondary" size="sm" onClick={() => write(mockTidy(msg, channel, text, firstName), "own")}>Edit Text</Button>}</div>
              <Button size="sm" disabled={!text.trim() || working} onClick={() => toast("A practice reply, so nothing was sent.")}>Send via {sendLabel}</Button>
            </div>
          </div>
        </div>

        <ol className="space-y-3 md:pt-11" aria-label="Ways to Reply">
          {WAYS.map((w) => {
            const done = tried.has(w.way);
            const Icon = done ? CircleCheck : Circle;
            return (
              <li key={w.way} className="flex gap-2">
                <Icon className={cn("mt-0.5 size-4 shrink-0", done ? "text-foreground" : "text-muted-foreground/50")} />
                <div>
                  <div className="text-sm font-medium">{w.title}</div>
                  <div className="text-xs text-muted-foreground">{w.detail}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </StepFrame>
  );
}
