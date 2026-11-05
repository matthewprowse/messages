// Security: how Konva protects client conversations today, where the data lives, and what is still being built. Every
// claim here must match docs/PLAN.md (Privacy and Encryption); nothing is promised before it is live. Suppliers are
// named in the Privacy Policy, where the law asks for them, not here.

import type { Metadata } from "next";
import { Download, EyeOff, Globe, KeyRound, LockKeyhole, Sparkles, UserLock } from "lucide-react";
import { pageMeta } from "@/components/marketing/page-meta";
import { Heading, PageIntro, Section } from "@/components/marketing/section";
import { Faq } from "@/components/marketing/faq";
import { ClosingCta } from "@/components/marketing/closing-cta";
import { JsonLd, breadcrumbData, faqData } from "@/components/marketing/json-ld";
import { Fill } from "@/components/marketing/legal";

const DESCRIPTION = "How Konva protects your client conversations: encryption with a key per user held in a hardware security module, AI that never trains on your data, two-factor sign in and a POPIA aligned design.";

export const metadata: Metadata = pageMeta({ title: "Security", description: DESCRIPTION, path: "/security" });

const TODAY = [
  // Live since 4 November 2026: every data key is wrapped by the HSM key (keys:readiness reports nothing under the old
  // software key), and names, addresses and numbers are sealed in every row (20261125100000 to 20261125120000, backfilled).
  { icon: LockKeyhole, title: "Encrypted With Your Own Key", text: "Message text, subjects, previews, summaries, drafts, replies waiting to send, contact names, email addresses and phone numbers are encrypted field by field with AES-256-GCM, under a data key unique to you. That key is wrapped by a key held in a hardware security module in Johannesburg, never by a key on our servers. Search still works, through indexes that reveal nothing. Konva's servers can use your key to do their work, as the questions below explain." },
  { icon: Sparkles, title: "AI That Never Trains on Your Data", text: "Konva's AI runs on an enterprise service under terms that forbid using your data to train models. It sees only what a feature needs, when it needs it." },
  { icon: UserLock, title: "Users Kept Apart", text: "Every table in the database checks who is asking. One person's conversations are never returned to another, and a team sees only what was shared with it." },
  { icon: KeyRound, title: "Safe Sign In", text: "Add an authenticator app for two-factor sign in. Gmail and Outlook connect through their own sign in, so Konva never sees those passwords." },
  { icon: EyeOff, title: "Analytics Without Content", text: "We count screens and actions to improve Konva. Analytics never contain message text, names, email addresses or phone numbers." },
  { icon: Download, title: "Your Data, Your Call", text: "Download everything Konva holds for you, opened with your own key in your browser, or delete your account and all of its data, from Settings at any time." },
];

const NEXT = [
  { title: "Sealed Processing", text: "The services that read your mail and WhatsApp running in sealed, attested machines, so that nobody at Konva can read what they process." },
  { title: "An Independent Security Assessment", text: "The independent assessment an app must pass before it may read Gmail for the public." },
];

const FAQ = [
  { q: "Can Konva staff read my messages?", a: "Message text is encrypted with your own key, and access to production systems is limited to the founder for running the service. We are moving to sealed processing so that nobody at Konva can read your messages, and we will say so here once it is live." },
  { q: "Is Konva POPIA compliant?", a: "Konva is designed around POPIA: it collects only what it needs, keeps content encrypted, and lets you see, download and delete your data. The Privacy Policy explains how we handle personal information and how to reach our Information Officer." },
  { q: "Does Konva sell or share my data?", a: "No. Konva does not sell data, show ads or share your conversations with anyone except the suppliers that run the service, under contract. The Privacy Policy lists them." },
  { q: "What happens when I delete my account?", a: "Your conversations, contacts, keys and files are deleted from Konva. To be thorough, also remove Konva from your Google or Microsoft account and log it out of WhatsApp's Linked Devices." },
];

export default function SecurityPage() {
  return (
    <>
      <JsonLd data={[breadcrumbData("Security", "/security"), faqData(FAQ)]} />
      <Section first className="pb-0 md:pb-0">
        <PageIntro title="How Konva Protects Your Privacy" lead="Your clients trust you with their messages, and you trust Konva with them. Here is how we look after them today, where they live and what we are still building." />
      </Section>

      <Section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TODAY.map((f) => (
            <div key={f.title} className="flex flex-col gap-4 rounded-2xl border bg-muted/30 p-6">
              <span className="flex size-10 items-center justify-center rounded-xl border bg-background"><f.icon className="size-4" aria-hidden /></span>
              <h2 className="text-base font-medium">{f.title}</h2>
              <p className="text-sm leading-6 text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section className="flex flex-col items-center gap-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl border bg-muted/40"><Globe className="size-5" aria-hidden /></span>
        <Heading title="Stored in the European Union" lead="Konva's data is stored in Ireland, under the EU's GDPR, which protects personal information at least as well as POPIA. That is what POPIA asks of information kept outside South Africa." center />
      </Section>

      <Section>
        <Heading title="What We Are Building Next" lead="We would rather tell you what is not finished than let you assume it is." center />
        <ol className="relative mx-auto mt-14 flex max-w-2xl flex-col gap-10 border-l pl-8">
          {NEXT.map((n) => (
            <li key={n.title} className="relative">
              <span className="absolute top-1.5 -left-[2.3rem] size-2.5 rounded-full border-2 border-background bg-foreground ring-1 ring-border" aria-hidden />
              <h3 className="text-base font-medium">{n.title}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{n.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section><Faq items={FAQ} /></Section>

      <Section className="flex flex-col items-center">
        <Heading title="Report a Security Issue" lead={<>If you find a vulnerability, email <Fill>security email</Fill>. We reply within one working day and will not take action against research done in good faith.</>} center />
      </Section>

      <ClosingCta />
    </>
  );
}
