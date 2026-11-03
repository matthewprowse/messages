// Everything around the conversation, as a bento of cards, each with a small picture of the feature drawn from the app's
// own pieces (badges, buttons, the demo people) rather than a table of icons and text.

import { Check, Play } from "lucide-react";
import { BrandLogo } from "@/components/provider-logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** A card: its picture on a background panel, then its title and line. */
function Card({ title, text, className, children }: { title: string; text: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-6 rounded-2xl border bg-muted/30 p-3", className)}>
      <div inert aria-hidden className="flex min-h-48 flex-col justify-center overflow-hidden rounded-xl border bg-background p-4 select-none md:h-48">{children}</div>
      <div className="flex flex-col gap-1.5 px-3 pb-3">
        <h3 className="text-base font-medium">{title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

const Avatar = ({ id, className }: { id: string; className?: string }) => <img src={`/demo/${id}.svg`} alt="" className={cn("size-8 shrink-0 rounded-full", className)} />;

function BriefPicture() {
  // Bar heights for the voice brief's waveform, in px.
  const bars = [6, 12, 18, 10, 22, 14, 8, 16, 24, 12, 6, 18, 10, 20, 14, 8, 12, 22, 16, 10, 6, 14, 18, 8];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-lg bg-muted/60 p-2 pr-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"><Play className="size-3.5 fill-current" /></span>
        <div className="flex h-6 min-w-0 flex-1 items-center gap-[3px] overflow-hidden">{bars.map((h, i) => <span key={i} className={cn("w-[3px] rounded-full", i < 9 ? "bg-foreground" : "bg-foreground/20")} style={{ height: h }} />)}</div>
        <span className="text-xs tabular-nums text-muted-foreground">2:10</span>
      </div>
      {[
        { dot: "bg-[var(--urgent)]", text: "Pieter's signed offer needs the seller's answer by Friday 12:00" },
        { dot: "bg-[var(--important)]", text: "Three new portal leads overnight, two with pre-approved bonds" },
        { dot: "bg-muted-foreground/40", text: "Viewing at 14 Kloof Street at 10:00" },
      ].map((l) => (
        <p key={l.text} className="flex items-center gap-2.5 text-sm [&>span:last-child]:min-w-0"><span className={cn("size-1.5 shrink-0 rounded-full", l.dot)} />{l.text}</p>
      ))}
    </div>
  );
}

function CalendarPicture() {
  return (
    <div className="flex flex-col gap-2 text-xs">
      {[
        { time: "10:00", title: "Viewing, 14 Kloof Street", who: "Thandi Mokoena", tone: "border-l-[var(--email)] bg-[var(--email-soft)] dark:bg-[var(--email)]/15" },
        { time: "14:30", title: "Lease Signing", who: "Naledi Dlamini", tone: "border-l-[var(--ok)] bg-[var(--ok-soft)] dark:bg-[var(--ok)]/15" },
      ].map((e) => (
        <div key={e.time} className="flex gap-3">
          <span className="w-9 pt-2 tabular-nums text-muted-foreground">{e.time}</span>
          <div className={cn("flex-1 rounded-md border-l-2 px-3 py-2", e.tone)}>
            <p className="font-medium text-foreground">{e.title}</p>
            <p className="text-muted-foreground">{e.who}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ClientPicture() {
  return (
    <div className="flex flex-col items-center gap-3">
      <Avatar id="thandi" className="size-12" />
      <p className="text-sm font-medium">Thandi Mokoena</p>
      <div className="flex gap-1.5">
        {(["whatsapp", "gmail", "instagram"] as const).map((b) => (
          <span key={b} className="flex size-8 items-center justify-center rounded-full border bg-background"><BrandLogo brand={b} /></span>
        ))}
      </div>
    </div>
  );
}

function TasksPicture() {
  return (
    <ul className="flex flex-col gap-2.5 text-sm">
      {[
        { text: "Send Thandi the lease", done: true },
        { text: "Book the valuation for Pieter", done: false },
        { text: "Ask the bond originator for an update", done: false },
      ].map((t) => (
        <li key={t.text} className="flex items-center gap-2.5">
          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border", t.done && "border-primary bg-primary text-primary-foreground")}>{t.done && <Check className="size-3" />}</span>
          <span className={cn(t.done && "text-muted-foreground line-through")}>{t.text}</span>
        </li>
      ))}
    </ul>
  );
}

function FollowUpPicture() {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/60 p-3">
      <Avatar id="james" className="size-10" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">James Carter<Badge variant="secondary">Follow Up</Badge></p>
        <p className="truncate text-xs text-muted-foreground">No reply in 3 days. Back at the top of your list.</p>
      </div>
    </div>
  );
}

export function FeatureBento() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card className="md:col-span-2" title="Your Morning Brief" text="New leads, who is waiting and what is on today, to read at your desk or listen to on the way in."><BriefPicture /></Card>
      <Card title="Calendar Beside the Chat" text="Google, Outlook and iCloud calendars next to your conversations, with notes for your meetings."><CalendarPicture /></Card>
      <Card title="One Client, Every App" text="The same person on WhatsApp, email and Instagram becomes one contact with one history."><ClientPicture /></Card>
      <Card title="Promises Become Tasks" text="What you say you will do in a chat lands in Google Tasks, Microsoft To Do or Reminders."><TasksPicture /></Card>
      <Card title="Nobody Goes Quiet on You" text="Snooze a conversation or set a follow up, and Konva brings it back when a client stops replying."><FollowUpPicture /></Card>
    </div>
  );
}
