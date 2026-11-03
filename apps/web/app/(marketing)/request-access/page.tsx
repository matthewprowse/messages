// Request Access: the closed beta's front door. The form beside what happens after it is sent.

import type { Metadata } from "next";
import { pageMeta } from "@/components/marketing/page-meta";
import { RequestAccessForm } from "@/components/marketing/request-access-form";
import { PageIntro, Section } from "@/components/marketing/section";
import { JsonLd, breadcrumbData } from "@/components/marketing/json-ld";

const DESCRIPTION = "Konva is in a closed beta for South African offices. Request access for your office or for yourself, and we will be in touch within one working day.";

export const metadata: Metadata = pageMeta({ title: "Request Access", description: DESCRIPTION, path: "/request-access" });

const STEPS = [
  { title: "We Read Every Request", text: "We reply within one working day, from a person, not a sequence of emails." },
  { title: "We Set Up Your Office With You", text: "For an office, a short call to connect everyone's accounts and share the right conversations. Most of it happens in the first session." },
  { title: "You Get Your Invite", text: "Everyone signs in from one invite link and finds their inbox already sorted." },
];

export default function RequestAccessPage() {
  return (
    <>
      <JsonLd data={breadcrumbData("Request Access", "/request-access")} />
      <Section first>
        <PageIntro title="Request Access" lead="Konva is in a closed beta. We are taking a small number of South African offices at a time, and setting each one up with them." />
        <div className="mx-auto mt-16 grid max-w-5xl items-start gap-10 md:grid-cols-[1fr_minmax(0,26rem)] md:gap-16">
          <ol className="flex flex-col divide-y border-y max-md:order-last">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4 py-5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">{i + 1}</span>
                <div className="flex flex-col gap-1">
                  <h2 className="text-sm font-medium">{s.title}</h2>
                  <p className="text-sm leading-6 text-muted-foreground">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="rounded-2xl border bg-background p-6 shadow-lg shadow-foreground/5 md:p-8">
            <RequestAccessForm />
          </div>
        </div>
      </Section>
    </>
  );
}
