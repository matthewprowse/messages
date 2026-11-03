// The public home page: the promise over the live inbox, the apps it connects, why it is built around the client,
// priority and drafts, the rest of the product, the trades it is for, prices and questions. Structured data describes
// the product and the FAQ for search engines.

import type { Metadata } from "next";
import Link from "next/link";
import { pageMeta } from "@/components/marketing/page-meta";
import { PRICES, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import { DemoDraft, DemoFrame, DemoInbox, DemoPriority } from "@/components/marketing/demo-app";
import { Heading, PageIntro, Section } from "@/components/marketing/section";
import { IntegrationsMarquee } from "@/components/marketing/integrations-marquee";
import { WhyKonva } from "@/components/marketing/why-konva";
import { FeatureBento } from "@/components/marketing/feature-bento";
import { IndustryShowcase } from "@/components/marketing/industry-showcase";
import { PlanCards } from "@/components/marketing/plan-cards";
import { Faq } from "@/components/marketing/faq";
import { ClosingCta } from "@/components/marketing/closing-cta";
import { JsonLd, faqData } from "@/components/marketing/json-ld";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TITLE = "Konva: Never Keep a Client Waiting";

export const metadata: Metadata = pageMeta({ title: TITLE, description: SITE_DESCRIPTION, path: "/", absolute: true });

const FAQ = [
  { q: "What is Konva?", a: "The client inbox for South African agents, brokers, attorneys and recruiters. Konva gathers each client's WhatsApps, emails and DMs into one conversation, marks the ones waiting on you and drafts replies in your own voice." },
  { q: "Which accounts can I connect?", a: "Gmail, Outlook, iCloud Mail and most other email accounts, WhatsApp and the WhatsApp Business app, LinkedIn and Instagram, plus Google, Outlook and iCloud calendars." },
  { q: "Does Konva send anything on its own?", a: "No. Drafts wait for you. Nothing goes to a client until you press Send." },
  { q: "Is my data safe?", a: "Message text, summaries and drafts are encrypted with a key of your own, and the AI runs under terms that never train on your data. Konva is built to be POPIA aligned." },
  { q: "What does it cost?", a: `R${PRICES.individual} a month for one person, or R${PRICES.seat} a seat for offices of ${PRICES.minSeats} or more, and about 20% less paid yearly. Prices exclude VAT.` },
  { q: "Can I start today?", a: "Konva is in a closed beta with a small number of South African offices. Request access and we will be in touch within one working day." },
];

const PRODUCT_DATA = [
  { "@context": "https://schema.org", "@type": "Organization", name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/icon-512.png` },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    offers: [
      { "@type": "Offer", name: "Individual", price: PRICES.individual, priceCurrency: "ZAR" },
      { "@type": "Offer", name: "Team Seat", price: PRICES.seat, priceCurrency: "ZAR" },
    ],
  },
];

export default function Home() {
  return (
    <>
      <JsonLd data={[...PRODUCT_DATA, faqData(FAQ)]} />
      <Section first className="pb-0 md:pb-0">
        <div className="flex flex-col items-center">
          <Badge variant="secondary" asChild className="mb-6"><Link href="/request-access">Closed Beta for South African Offices</Link></Badge>
          <PageIntro
            title="Never Keep a Client Waiting"
            lead="Konva gathers each client's WhatsApps, emails and DMs into one conversation, puts the ones waiting on you first and drafts the reply in your own voice."
          >
            <Button asChild size="lg"><Link href="/request-access">Request Access</Link></Button>
            <Button asChild size="lg" variant="ghost"><Link href="/pricing">See Pricing</Link></Button>
          </PageIntro>
        </div>
        <div className="mt-16 [mask-image:linear-gradient(to_bottom,black_75%,transparent)] md:mt-20">
          <DemoFrame label="The Konva inbox: client conversations from WhatsApp, Gmail, Outlook, LinkedIn and Instagram, with a WhatsApp chat open and Konva drafting the reply" className="h-[560px] md:h-[640px]">
            <DemoInbox live />
          </DemoFrame>
        </div>
      </Section>

      <section className="pb-8 reveal">
        <p className="mb-8 px-4 text-center text-sm text-muted-foreground">Works with the apps your clients already use</p>
        <IntegrationsMarquee />
      </section>

      <Section>
        <Heading title="Built Around the Client, Not the Inbox" lead="Other AI inboxes help you get through your messages. Konva helps you keep your clients." center />
        <div className="mt-16"><WhyKonva /></div>
      </Section>

      <Section id="product">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <Heading title="See Who Is Waiting on You" lead="Konva reads every new message and marks what needs you: a signed offer with a deadline, a buyer ready to view, a lead from a portal. Each conversation gets one line saying what it is about, so you know without opening it." />
          <DemoFrame label="Four conversations marked Urgent or Needs Reply, each with a one line summary" className="h-[360px]">
            <DemoPriority />
          </DemoFrame>
        </div>
      </Section>

      <Section>
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <DemoFrame label="A WhatsApp chat with a reply drafted by Konva, waiting to be sent" className="h-[420px] max-md:order-last">
            <DemoDraft />
          </DemoFrame>
          <Heading title="Replies That Sound Like You" lead="Konva learns how you write from the messages you have sent, then drafts each reply the way you would: your greeting, your length, your tone. Read it, change it if you like, and press Send." />
        </div>
      </Section>

      <Section>
        <Heading title="Everything Around the Conversation" lead="The calendar, the follow up and the promise you made, in the same place as the client." center />
        <div className="mt-14"><FeatureBento /></div>
      </Section>

      <Section id="industries">
        <Heading title="Built for People Who Win Work by Replying First" lead="Konva speaks the language of each trade it serves, down to the conversations it puts first." center />
        <div className="mt-14"><IndustryShowcase /></div>
      </Section>

      <Section>
        <Heading title="Simple Prices in Rand" lead="Every AI feature on every plan. Prices exclude VAT." center />
        <div className="mt-12"><PlanCards /></div>
        <div className="mt-8 flex justify-center"><Button asChild variant="ghost"><Link href="/pricing">Compare Plans</Link></Button></div>
      </Section>

      <Section><Faq items={FAQ} /></Section>
      <ClosingCta />
    </>
  );
}
