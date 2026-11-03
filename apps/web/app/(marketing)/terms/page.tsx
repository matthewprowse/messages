// Terms of Use: a template for the beta, with the fair usage wording from docs/PLAN.md and the risks of connecting
// third party messaging accounts. The highlighted details are filled in once the company is registered, and a lawyer
// should read it before launch.

import type { Metadata } from "next";
import { pageMeta } from "@/components/marketing/page-meta";
import { PRICES } from "@/lib/site";
import { Clause, Fill, LegalPage, TextLink } from "@/components/marketing/legal";
import { JsonLd, breadcrumbData } from "@/components/marketing/json-ld";

export const metadata: Metadata = pageMeta({ title: "Terms of Use", description: "The terms for using Konva: accounts, connected services, AI drafts, teams, fees, fair usage and your data.", path: "/terms" });

export default function TermsPage() {
  return (
    <>
      <JsonLd data={breadcrumbData("Terms of Use", "/terms")} />
      <LegalPage
        title="Terms of Use"
        updated="3 November 2026"
        intro={<p>These terms are an agreement between you and <Fill>Company Name</Fill> (Pty) Ltd, registration number <Fill>Registration Number</Fill> (&quot;Konva&quot;, &quot;we&quot;, &quot;us&quot;), for your use of Konva. By creating an account or using Konva you accept them. If you use Konva for a business, you accept them for that business too.</p>}
      >
        <Clause n={1} title="The Service">
          <p>Konva brings your email, WhatsApp, LinkedIn, Instagram, calendars and tasks into one place, sorts conversations by client and priority, and drafts replies for you to review. Features change as Konva improves.</p>
        </Clause>

        <Clause n={2} title="The Beta">
          <p>Konva is in a closed beta. Access is by invitation, features may change or be withdrawn, and the service may sometimes be unavailable while we improve it. We will tell you before any change that affects what you pay.</p>
        </Clause>

        <Clause n={3} title="Your Account">
          <ul>
            <li>You must be 18 or older and give accurate details.</li>
            <li>Keep your sign in details safe, and turn on two-factor sign in. You are responsible for what happens in your account.</li>
            <li>Tell us straight away at <Fill>support email</Fill> if you think someone else has used your account.</li>
          </ul>
        </Clause>

        <Clause n={4} title="Accounts You Connect">
          <p>You may connect only accounts you are allowed to use, and you remain bound by those services&apos; own terms. Gmail, Outlook, Instagram and calendars connect through their official sign in. WhatsApp and LinkedIn connect the way their own web apps do, which those services do not formally support: they may limit, sign out or suspend an account they believe is automated. Konva sends only what you send and limits how much it sends in a day, but we cannot guarantee how another service will treat your account, and we are not responsible for its decisions.</p>
        </Clause>

        <Clause n={5} title="AI Drafts and Your Messages">
          <p>Konva&apos;s summaries, priorities and drafts are made by AI and can be wrong. Nothing is sent to anyone until you choose to send it, and you are responsible for every message you send from Konva, as you would be from your own phone or email.</p>
        </Clause>

        <Clause n={6} title="Acceptable Use">
          <p>You must not use Konva to send spam or unsolicited bulk messages, to harass anyone, to break the law (including POPIA and the Electronic Communications and Transactions Act), to infringe anyone&apos;s rights, or to try to access another person&apos;s data, overload the service or reverse engineer it.</p>
        </Clause>

        <Clause n={7} title="Teams">
          <p>A team&apos;s owner decides who joins it and which client conversations are shared with it. Conversations shared with a team stay with the team when a member leaves, so the business keeps its client history. Conversations marked personal stay private to the person they belong to. If you join a team, you agree that the conversations you share with it belong to the team.</p>
        </Clause>

        <Clause n={8} title="Fees">
          <p>Individual accounts cost R{PRICES.individual} a month and team seats R{PRICES.seat} a seat a month, with at least {PRICES.minSeats} seats, or R{PRICES.individualYearly} and R{PRICES.seatYearly} a month when paid a year in advance, excluding VAT, which is added once we are VAT registered. Fees are billed in advance, monthly or yearly, and are not refunded for part of a period. We will give you at least 30 days&apos; notice of any price change.</p>
        </Clause>

        <Clause n={9} title="Fair Usage">
          <p>AI features are included at a generous monthly allowance for each person. Settings shows how much of it you have used. If you go well past it, the heaviest features, such as meeting transcripts, pause until the allowance resets on the 1st. Sorting, Junk, your brief and first drafts keep running, and nothing is deleted.</p>
          <p>Konva keeps your attachments so you can search and find them later, within a fair storage allowance. Files already stored are never removed because of it.</p>
        </Clause>

        <Clause n={10} title="Your Content">
          <p>Your messages, contacts and files remain yours. You give us permission to store and process them only to provide Konva to you and your team. Our <TextLink href="/privacy">Privacy Policy</TextLink> explains how we handle personal information.</p>
        </Clause>

        <Clause n={11} title="Ending Your Use">
          <p>You may stop using Konva and delete your account at any time in Settings. We may suspend or close an account that breaks these terms or puts the service or other people at risk, and where we can, we will tell you first and give you time to download your data.</p>
        </Clause>

        <Clause n={12} title="Disclaimers and Liability">
          <p>Konva is provided as it is during the beta. To the extent the law allows, we do not guarantee it will be uninterrupted or error free, and we are not liable for indirect or consequential loss, such as lost business or clients. Our total liability to you is limited to the fees you paid us in the 12 months before the claim. Nothing in these terms limits rights you have under the Consumer Protection Act where it applies.</p>
        </Clause>

        <Clause n={13} title="Changes to These Terms">
          <p>We may update these terms. If a change matters, we will tell you in Konva or by email at least 30 days before it takes effect. Continuing to use Konva after that means you accept the new terms.</p>
        </Clause>

        <Clause n={14} title="Law and Disputes">
          <p>These terms are governed by the law of South Africa, and the courts of South Africa have jurisdiction. Please contact us first so we can try to resolve any dispute together.</p>
        </Clause>

        <Clause n={15} title="Contact">
          <p><Fill>Company Name</Fill> (Pty) Ltd, <Fill>Registered Address</Fill>, <Fill>support email</Fill>.</p>
        </Clause>
      </LegalPage>
    </>
  );
}
