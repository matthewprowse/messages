import type { Metadata } from "next";
import { Check, ShieldCheck } from "lucide-react";
import { BrandLogo, type Brand } from "@/components/provider-logo";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { WaitlistForm } from "@/components/marketing/waitlist-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: { absolute: "Konva: Every Client Conversation, in One Place" },
  description: "Konva brings WhatsApp, email and your calendar together, sorted by client, so you reply first and never lose a lead. Request early access.",
};

// The marketing page, while Konva is invite only. Five sections, each modelled on a Mobbin reference:
// the hero with the request form (ISO Meet), Works With (Slack), three feature cards with a small picture of
// the product (Extra), privacy (Campsite and Grain) and a closing request form (Base).

const WORKS_WITH: { brand: Brand; name: string }[] = [
  { brand: "whatsapp", name: "WhatsApp" },
  { brand: "gmail", name: "Gmail" },
  { brand: "outlook", name: "Outlook" },
  { brand: "icloud", name: "iCloud Mail" },
  { brand: "google", name: "Google Calendar" },
];

// Only what is true today: see Where It Stands in docs/PLAN.md.
const PRIVACY = [
  "Message text is encrypted with AES-256 under a key that belongs to your account alone.",
  "Email addresses and phone numbers are stored encrypted too, so the database matches them without reading them.",
  "Analytics count clicks and screens, never content: no message text, names or addresses.",
];

function SectionHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h2>
      <p className="mt-3 text-muted-foreground">{sub}</p>
    </div>
  );
}

function FeatureCard({ title, children, picture }: { title: string; children: React.ReactNode; picture: React.ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div aria-hidden className="flex h-56 flex-col justify-center gap-2 bg-muted p-5">{picture}</div>
      <div className="p-5">
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function TimelineRow({ brand, text, time }: { brand: Brand; text: string; time: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
      <BrandLogo brand={brand} className="size-3.5" />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <span className="text-xs text-muted-foreground">{time}</span>
    </div>
  );
}

function ReplyRow({ name, text, needsReply }: { name: string; text: string; needsReply?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-medium">{name.split(" ").filter((_, i, all) => i === 0 || i === all.length - 1).map((w) => w[0]).join("")}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{text}</p>
      </div>
      {needsReply && <Badge variant="secondary">Needs Reply</Badge>}
    </div>
  );
}

export default function MarketingPage() {
  return (
    <div className="min-h-dvh bg-background">
      <MarketingNav />
      <main>
        {/* Hero, with the request form */}
        <section id="request" className="scroll-mt-14 px-4 pt-20 pb-16 sm:pt-28">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <Badge variant="secondary">Early Access</Badge>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Every Client Conversation, in One Place</h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground text-balance">
              Konva brings WhatsApp, email and your calendar together, sorted by client, so you reply first and never lose a lead.
            </p>
            <WaitlistForm id="hero" className="mt-10 w-full max-w-md" />
            <p className="mt-4 text-xs text-muted-foreground">We are letting people in in small groups. We only use your details to contact you about Konva.</p>
          </div>
        </section>

        {/* Works With */}
        <section className="border-t px-4 py-20">
          <SectionHeading title="Works With the Apps Your Clients Already Use" sub="Connect your accounts once. Every message and meeting lands in Konva, matched to the right client." />
          <ul className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-5">
            {WORKS_WITH.map(({ brand, name }) => (
              <li key={brand} className="flex flex-col items-center gap-3">
                <span className="flex size-16 items-center justify-center rounded-xl border bg-card">
                  <BrandLogo brand={brand} className="size-8" />
                </span>
                <span className="text-sm">{name}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Features */}
        <section className="border-t px-4 py-20">
          <SectionHeading title="Built for People Who Cannot Afford to Miss a Client" sub="Your clients message you everywhere. Konva makes sure every one of them gets an answer." />
          <div className="mx-auto mt-10 grid max-w-5xl gap-4 lg:grid-cols-3">
            <FeatureCard
              title="Sorted by Client, Not by App"
              picture={
                <>
                  <p className="text-xs font-medium text-muted-foreground">Thandi Mokoena</p>
                  <TimelineRow brand="whatsapp" text="Is the flat still available?" time="09:12" />
                  <TimelineRow brand="gmail" text="Offer to purchase" time="Yesterday" />
                  <TimelineRow brand="google" text="Viewing at 14:00" time="Friday" />
                </>
              }
            >
              One timeline per client, with their WhatsApps, emails and meetings together.
            </FeatureCard>
            <FeatureCard
              title="Know Who Needs a Reply"
              picture={
                <>
                  <ReplyRow name="Pieter van Wyk" text="Can we move the viewing?" needsReply />
                  <ReplyRow name="Aisha Patel" text="Signed mandate attached" needsReply />
                  <ReplyRow name="Sipho Ndlovu" text="Thanks, see you then" />
                </>
              }
            >
              Konva reads every new message and puts the ones waiting on you first.
            </FeatureCard>
            <FeatureCard
              title="Drafts in Your Voice"
              picture={
                <div className="flex flex-col gap-2">
                  <div className="max-w-[85%] self-start rounded-2xl bg-background px-3 py-2 text-sm">Can we move the viewing to Saturday?</div>
                  <div className="max-w-[85%] self-end rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">Saturday works. Shall we say 10:00 at the flat?</div>
                  <div className="flex items-center justify-end gap-2">
                    <Badge variant="outline" className="bg-background">Draft</Badge>
                    <Button size="sm" tabIndex={-1}>Send</Button>
                  </div>
                </div>
              }
            >
              Replies written the way you write, ready to check and send in one tap.
            </FeatureCard>
          </div>
        </section>

        {/* Privacy */}
        <section className="border-t px-4 py-20">
          <div className="mx-auto max-w-3xl rounded-xl bg-muted p-8 sm:p-12">
            <ShieldCheck className="size-8" />
            <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">Private by Design</h2>
            <p className="mt-3 text-muted-foreground">Your client conversations are your business. Konva is built so they stay that way.</p>
            <ul className="mt-8 flex flex-col gap-4">
              {PRIVACY.map((line) => (
                <li key={line} className="flex gap-3 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Final call to action */}
        <section className="border-t px-4 py-20">
          <div className="mx-auto grid max-w-4xl items-center gap-10 md:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Get Early Access</h2>
              <p className="mt-3 text-muted-foreground">Konva is opening to a small number of teams and professionals first. Request access and we will email you when your account is ready.</p>
            </div>
            <WaitlistForm id="footer" />
          </div>
        </section>
      </main>
      <footer className="border-t px-4 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between text-sm text-muted-foreground">
          <span>Konva</span>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
