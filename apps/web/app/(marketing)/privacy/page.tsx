// Privacy Policy: a POPIA template with the Google API Limited Use statement verification asks for. The highlighted
// details (company, registration, address, Information Officer) are filled in once the company is registered, and a
// lawyer should read it before launch.

import type { Metadata } from "next";
import { pageMeta } from "@/components/marketing/page-meta";
import { Clause, Fill, LegalPage, TextLink } from "@/components/marketing/legal";
import { JsonLd, breadcrumbData } from "@/components/marketing/json-ld";

export const metadata: Metadata = pageMeta({ title: "Privacy Policy", description: "How Konva collects, uses, protects and deletes personal information, and your rights under POPIA.", path: "/privacy" });

export default function PrivacyPage() {
  return (
    <>
      <JsonLd data={breadcrumbData("Privacy Policy", "/privacy")} />
      <LegalPage
        title="Privacy Policy"
        updated="3 November 2026"
        intro={<p>Konva brings your client conversations into one place. To do that it handles personal information about you and about the people you talk to. This policy explains what we collect, why, how we protect it and the rights you have under the Protection of Personal Information Act, 2013 (POPIA).</p>}
      >
        <Clause n={1} title="Who We Are">
          <p>Konva is operated by <Fill>Company Name</Fill> (Pty) Ltd, registration number <Fill>Registration Number</Fill>, of <Fill>Registered Address</Fill> (&quot;Konva&quot;, &quot;we&quot;, &quot;us&quot;). We are the responsible party for the personal information described here.</p>
          <p>Our Information Officer is <Fill>Information Officer Name</Fill>, who can be reached at <Fill>privacy email</Fill>.</p>
        </Clause>

        <Clause n={2} title="What We Collect">
          <ul>
            <li><strong>Your account.</strong> Your name, email address, password or sign-in method, and your settings.</li>
            <li><strong>Accounts you connect.</strong> When you connect email, WhatsApp, LinkedIn, Instagram, a calendar or a task list, we collect the messages, contacts, attachments, events and tasks in it, so Konva can show, sort and search them. You choose which accounts to connect and can disconnect them at any time.</li>
            <li><strong>Your team.</strong> If you join a team, your name and role in it, and the conversations shared with it.</li>
            <li><strong>Usage.</strong> Which screens are opened and which features are used, with no message text, names, email addresses or phone numbers.</li>
            <li><strong>Technical information.</strong> Your browser, device and IP address, kept in logs to run and secure the service.</li>
            <li><strong>Access requests.</strong> If you request access, your email address and, for an office, its name and size.</li>
          </ul>
        </Clause>

        <Clause n={3} title="How We Use It">
          <p>We use personal information only to provide Konva to you: to show your conversations, sort them by client and priority, summarise them, draft replies for you to review, prepare your morning brief, keep your calendar and tasks in step, support you, keep the service secure and bill for it.</p>
          <p>We do not sell personal information, show advertising or use your conversations for marketing. We process it because it is needed to perform our agreement with you, because you have consented (for example, by connecting an account), or because we have a legitimate interest in keeping Konva secure.</p>
        </Clause>

        <Clause n={4} title="Artificial Intelligence">
          <p>Konva&apos;s AI features run on Google Gemini through Google Cloud. The text a feature needs is sent to the model when it runs, and the result is stored encrypted in your account. Google processes it under terms that do not allow it to be used to train models, and Konva does not use your data to train models either.</p>
          <p>AI output can be wrong. Drafts are never sent without you, and you remain responsible for what you send.</p>
        </Clause>

        <Clause n={5} title="Information From Google">
          <p>Konva&apos;s use and transfer to any other app of information received from Google APIs will adhere to the <TextLink href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</TextLink>, including the Limited Use requirements.</p>
          <ul>
            <li>We use Gmail, Google Calendar and Google Tasks data only to provide the features you see in Konva.</li>
            <li>We do not use it for advertising, do not sell it and do not transfer it to others except to provide the service, for security, or where the law requires.</li>
            <li>No person at Konva reads it unless you ask us to for support, it is needed for security, or the law requires it.</li>
            <li>We do not use it to develop, improve or train generalised AI or machine learning models.</li>
          </ul>
        </Clause>

        <Clause n={6} title="How We Protect It">
          <p>Message text, subjects, summaries and drafts are encrypted field by field with AES-256-GCM under a data key that belongs to you. Access to data is limited by row level security, so one person&apos;s data is never returned to another. Connections are encrypted in transit, and you can add two-factor sign in. See <TextLink href="/security">Security</TextLink> for the details, including what we are still building.</p>
        </Clause>

        <Clause n={7} title="Who We Share It With">
          <p>We share personal information only with the operators that run Konva for us, under written agreements that require them to keep it secure and use it only on our instructions:</p>
          <ul>
            <li>Supabase, for the database, file storage and sign in (Ireland).</li>
            <li>Vercel, for the web app (Dublin).</li>
            <li>Google Cloud, for AI and for the background services that keep your accounts in step.</li>
            <li><Fill>Email provider</Fill>, for account emails.</li>
          </ul>
          <p>Within a team, conversations shared with the team are visible to its members. We may also disclose information where the law requires it.</p>
        </Clause>

        <Clause n={8} title="Information Sent Outside South Africa">
          <p>Konva&apos;s data is stored in Ireland, in the European Union. Personal information is transferred there under section 72 of POPIA, as the EU&apos;s General Data Protection Regulation gives it protection at least equal to POPIA, and our operators are bound by agreements to protect it.</p>
        </Clause>

        <Clause n={9} title="How Long We Keep It">
          <p>We keep your information while your account is open. When you delete your account, your conversations, contacts, keys and files are deleted from Konva within <Fill>30</Fill> days, apart from what the law requires us to keep, such as billing records. Backups are overwritten within <Fill>backup period</Fill>. Access requests that do not become accounts are deleted after 12 months.</p>
        </Clause>

        <Clause n={10} title="Your Rights">
          <p>Under POPIA you may ask what personal information we hold about you, ask us to correct or delete it, object to how we use it and withdraw consent. You can download or delete all your data yourself in Settings, or email our Information Officer.</p>
          <p>If you are unhappy with how we have handled your information, please tell us first. You may also complain to the Information Regulator at <TextLink href="https://inforegulator.org.za">inforegulator.org.za</TextLink>.</p>
        </Clause>

        <Clause n={11} title="The People You Talk To">
          <p>Your conversations include personal information about your clients and contacts. You decide which accounts to connect, and you are responsible for having a lawful reason to process your clients&apos; information in Konva, as you would in your own email or phone. We process it only to provide Konva to you.</p>
        </Clause>

        <Clause n={12} title="Cookies and Local Storage">
          <p>Konva uses only the browser storage it needs to keep you signed in, remember your settings and keep an encrypted copy of your data for speed. It does not use advertising or tracking cookies.</p>
        </Clause>

        <Clause n={13} title="Children">
          <p>Konva is a service for working professionals and is not meant for anyone under 18.</p>
        </Clause>

        <Clause n={14} title="Changes to This Policy">
          <p>If we change this policy in a way that matters, we will tell you in Konva or by email before the change takes effect.</p>
        </Clause>

        <Clause n={15} title="Contact">
          <p>Questions about privacy go to our Information Officer, <Fill>Information Officer Name</Fill>, at <Fill>privacy email</Fill> or <Fill>Registered Address</Fill>.</p>
        </Clause>
      </LegalPage>
    </>
  );
}
