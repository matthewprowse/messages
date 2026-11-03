// The three things that make Konva different from a general AI inbox: it is organised around the client, the office
// owns the client, and it is made for how South African professionals work. See docs/MARKETING-SITE.md, Positioning.

import { Building2, MapPin, UserRound } from "lucide-react";

const PILLARS = [
  { icon: UserRound, title: "Sorted by Client, Not by App", text: "A buyer who emails, then WhatsApps, then sends a DM is one person with one history. You see the relationship, not five inboxes." },
  { icon: Building2, title: "The Office Keeps the Client", text: "Client conversations are shared with the office and personal chats stay private. When someone moves on, the history and the client stay." },
  { icon: MapPin, title: "Made for South Africa", text: "WhatsApp first, priced in rand, built to be POPIA aligned, and set up with your office at hours that suit a working day." },
];

export function WhyKonva() {
  return (
    <div className="grid gap-12 md:grid-cols-3 md:gap-10">
      {PILLARS.map((p) => (
        <div key={p.title} className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl border bg-muted/40"><p.icon className="size-5" aria-hidden /></span>
          <h3 className="text-lg font-medium tracking-tight">{p.title}</h3>
          <p className="max-w-xs text-sm leading-6 text-muted-foreground">{p.text}</p>
        </div>
      ))}
    </div>
  );
}
