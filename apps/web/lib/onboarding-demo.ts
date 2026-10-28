"use client";

// MOCK DATA for onboarding, until the workers report real numbers and the AI worker writes the first
// profile during setup. Everything the setup dialog shows about "what Konva found" comes from here, so
// swapping in the real thing touches only this file. Nothing here is saved unless the user keeps it.

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------------------------------------
// The first import
// ---------------------------------------------------------------------------------------------------------

/** How long the pretend first import takes, from the first connected account. */
const IMPORT_MS = 20_000;
const STARTED_KEY = "konva-demo-import-started";

export interface ImportCounts {
  emails: number;
  whatsapp: number;
  conversations: number;
  contacts: number;
}

const TARGETS: ImportCounts = { emails: 1284, whatsapp: 3117, conversations: 486, contacts: 312 };

/** Forget the pretend import, so running setup again starts it from nothing. */
export function resetMockImport() {
  try { sessionStorage.removeItem(STARTED_KEY); } catch { /* storage blocked: the import just restarts */ }
}

/**
 * The pretend import: counts that climb while the workers "run", from when `running` first turned true.
 * Only the channels connected count: no WhatsApp linked, no WhatsApp messages.
 */
export function useMockImport(running: boolean, channels: { mail: boolean; whatsapp: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [started, setStarted] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return;
    let at = Date.now();
    try {
      const saved = Number(sessionStorage.getItem(STARTED_KEY));
      if (saved > 0) at = saved;
      else sessionStorage.setItem(STARTED_KEY, String(at));
    } catch { /* storage blocked: counts from now */ }
    setStarted(at);
  }, [running]);

  const progress = started === null ? 0 : Math.min(1, (now - started) / IMPORT_MS);
  useEffect(() => {
    if (started === null || progress >= 1) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [started, progress]);

  // Fast at first and slower towards the end, like a real backfill.
  const eased = 1 - Math.pow(1 - progress, 2.2);
  const share = (n: number, on: boolean) => (on ? Math.round(n * eased) : 0);
  const counts: ImportCounts = {
    emails: share(TARGETS.emails, channels.mail),
    whatsapp: share(TARGETS.whatsapp, channels.whatsapp),
    conversations: share(TARGETS.conversations, channels.mail || channels.whatsapp),
    contacts: share(TARGETS.contacts, channels.mail || channels.whatsapp),
  };
  return { started: started !== null, progress, done: progress >= 1, counts };
}

// ---------------------------------------------------------------------------------------------------------
// What Konva wrote about you
// ---------------------------------------------------------------------------------------------------------

export type Role = "estate_agent" | "broker" | "attorney" | "recruiter" | "other";

export const ROLES: { value: Role; label: string }[] = [
  { value: "estate_agent", label: "Estate Agent" },
  { value: "broker", label: "Broker or Adviser" },
  { value: "attorney", label: "Attorney" },
  { value: "recruiter", label: "Recruiter" },
  { value: "other", label: "Something Else" },
];

const ABOUT: Record<Role, string> = {
  estate_agent:
    "You're an estate agent. Most of your conversations are with buyers and sellers arranging viewings, offers and transfers, and with attorneys and bond originators on deals in progress. Clients mostly reach you on WhatsApp; email is mainly for documents and offers.",
  broker:
    "You're an insurance broker and financial adviser. Most conversations are with clients about cover, claims and renewals, and with insurers' underwriters. Clients send quick questions on WhatsApp and documents by email.",
  attorney:
    "You're an attorney. Most of your mail is with clients and opposing attorneys about matters in progress, with deadlines and court dates in the detail. Clients use WhatsApp for quick updates.",
  recruiter:
    "You're a recruiter. Most conversations are with candidates about roles and interviews, and with hiring managers about shortlists and offers. Candidates reply fastest on WhatsApp.",
  other:
    "Most of your conversations are with clients and the people you work alongside. Clients reach you on WhatsApp for quick questions and by email for anything with documents.",
};

export const MOCK_WRITING =
  "Short and friendly. You open with the person's first name, keep most replies to two or three sentences, and sign off with just your first name. On WhatsApp you're more relaxed and use the odd emoji; on email you're a touch more formal and confirm times in full, like 10:00 on Saturday.";

export interface Person {
  name: string;
  why: string;
}

export const MOCK_PEOPLE: Person[] = [
  { name: "Priya Naidoo", why: "Buyer, with an offer in progress" },
  { name: "Thandi Mokoena", why: "Seller, mandate signed last week" },
  { name: "Johan van Wyk", why: "Conveyancing attorney on two of your deals" },
  { name: "Lerato Dlamini", why: "Your branch manager" },
];

/** What Konva "wrote" about you from your role and anything you added. */
export function mockAbout(role: Role | "", extra: string): string {
  const base = ABOUT[role || "other"];
  return extra.trim() ? `${base} ${sentence(extra)}` : base;
}

/** Pretend to apply an instruction to a piece of text: the instruction lands as a sentence of its own. */
export function mockRefine(text: string, instruction: string): string {
  return `${text.trim()} ${sentence(instruction)}`;
}

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const capital = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/** The people list as the Important People setting stores it, one per line. */
export function peopleText(people: Person[]): string {
  return people.map((p) => `${p.name}: ${p.why}`).join("\n");
}

// ---------------------------------------------------------------------------------------------------------
// Contacts to tidy
// ---------------------------------------------------------------------------------------------------------

export interface Identity {
  kind: "email" | "whatsapp";
  value: string;
  label: string;
}

export interface ContactSuggestion {
  id: string;
  action: "merge" | "split";
  name: string;
  reason: string;
  identities: Identity[];
  /** For a split: the names the two people would have. */
  into?: string[];
}

export const MOCK_SUGGESTIONS: ContactSuggestion[] = [
  {
    id: "thandi",
    action: "merge",
    name: "Thandi Mokoena",
    reason: "The same name, and her emails are signed with this WhatsApp number.",
    identities: [
      { kind: "email", value: "thandi.mokoena@example.com", label: "Email" },
      { kind: "whatsapp", value: "+27 82 555 0143", label: "WhatsApp" },
    ],
  },
  {
    id: "johan",
    action: "merge",
    name: "Johan van Wyk",
    reason: "The same name, and both addresses write about the transfer on 14 Kloof Street.",
    identities: [
      { kind: "email", value: "johan@vanwyk-attorneys.example", label: "Work Email" },
      { kind: "email", value: "jvanwyk@example.com", label: "Personal Email" },
    ],
  },
  {
    id: "sam",
    action: "split",
    name: "Sam",
    reason: "Two people seem to share this contact. They write about different properties and sign off differently.",
    identities: [
      { kind: "whatsapp", value: "+27 71 555 0199", label: "WhatsApp, signs as Sam Botha" },
      { kind: "email", value: "sam.pillay@example.com", label: "Email, signs as Sam Pillay" },
    ],
    into: ["Sam Botha", "Sam Pillay"],
  },
];

// ---------------------------------------------------------------------------------------------------------
// A practice reply
// ---------------------------------------------------------------------------------------------------------

export type DemoChannel = "email" | "whatsapp";
export type Tone = "shorter" | "formal" | "casual";

export interface DemoChoice {
  label: string;
  draft: string;
}

export interface DemoMessage {
  from: string;
  firstName: string;
  subject?: string;
  body: string;
  choices: DemoChoice[];
}

export function demoMessage(channel: DemoChannel, me: string): DemoMessage {
  const sign = me || "Me";
  if (channel === "email") {
    return {
      from: "Priya Naidoo",
      firstName: "Priya",
      subject: "Viewing on Saturday?",
      body: "Hi,\n\nWe loved the photos of 14 Kloof Street. Could we view it this Saturday morning? Also, is the seller open to offers below the asking price?\n\nThanks,\nPriya",
      choices: [
        { label: "Saturday 10:00 Works", draft: `Hi Priya,\n\nThanks for getting in touch. Saturday at 10:00 works well, and I'll meet you at the front gate.\n\nThe seller is open to reasonable offers, so we can talk it through after you've seen the place.\n\n${sign}` },
        { label: "Suggest Another Time", draft: `Hi Priya,\n\nThanks for getting in touch. Saturday morning is fully booked, but I could show you the flat on Saturday at 14:00 or Sunday at 10:00. Which suits you better?\n\nThe seller is open to reasonable offers, so we can talk it through after you've seen it.\n\n${sign}` },
        { label: "Ask About Their Budget", draft: `Hi Priya,\n\nThanks for getting in touch. I'd be glad to arrange a viewing on Saturday morning.\n\nBefore we talk about offers, could you share the budget you're working with and whether you have bond pre-approval? It helps me position an offer with the seller.\n\n${sign}` },
      ],
    };
  }
  return {
    from: "Thandi Mokoena",
    firstName: "Thandi",
    body: "Hi! Just checking, did the buyers come back on the offer? We're hoping to sign this week 🙏",
    choices: [
      { label: "Not Yet, Chasing Today", draft: `Hi Thandi, not yet. I'm following up with them today and will let you know as soon as I hear 👍` },
      { label: "Yes, They Accepted", draft: `Hi Thandi, good news: they've accepted! I'll send the offer through for signing this afternoon 🎉` },
      { label: "Suggest a Quick Call", draft: `Hi Thandi, there's been some movement. Easier to explain on a quick call. Are you free at 16:00?` },
    ],
  };
}

/** A draft from what you said it should say: the "What To Say" box. */
export function mockFromInstruction(msg: DemoMessage, channel: DemoChannel, instruction: string, me: string): string {
  const said = sentence(instruction);
  return channel === "email"
    ? `Hi ${msg.firstName},\n\nThanks for getting in touch. ${said}\n\n${me || "Me"}`
    : `Hi ${msg.firstName}, ${said.charAt(0).toLowerCase()}${said.slice(1)}`;
}

/** Your own words, tidied: capitals, full stops, a greeting and a sign-off. The "Edit Text" button. */
export function mockTidy(msg: DemoMessage, channel: DemoChannel, text: string, me: string): string {
  let t = text.trim().replace(/\s+/g, " ").replace(/\bi\b/g, "I");
  t = t.replace(/(^|[.!?]\s+)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
  if (!/[.!?]$/.test(t)) t += ".";
  if (!/^(hi|hello|dear|hey)\b/i.test(t)) t = channel === "email" ? `Hi ${msg.firstName},\n\n${t}` : `Hi ${msg.firstName}, ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  return channel === "email" && !t.endsWith(me) ? `${t}\n\n${me || "Me"}` : t;
}

/** The Adjust menu: the same reply, shorter, more formal or more casual. */
export function mockAdjust(text: string, tone: Tone): string {
  if (tone === "shorter") {
    const paras = text.split(/\n\n/);
    const body = paras.length > 2 ? paras.slice(1, -1).join(" ") : text;
    const first = body.match(/^[^.!?]*[.!?]/)?.[0] ?? body;
    return paras.length > 2 ? `${paras[0]}\n\n${first.trim()}\n\n${paras[paras.length - 1]}` : first.trim();
  }
  if (tone === "formal") {
    return text
      .replace(/^Hi (\w+),/, "Dear $1,")
      .replace(/Thanks for getting in touch\./, "Thank you for your message.")
      .replace(/\bI'll\b/g, "I will")
      .replace(/\bI'd\b/g, "I would")
      .replace(/\bit's\b/g, "it is")
      .replace(/\s*[🙏👍🎉]/gu, "")
      .replace(/\n\n(\S+)$/, "\n\nKind regards,\n$1");
  }
  return text
    .replace(/^Dear (\w+),/, "Hi $1,")
    .replace(/Thank you for your message\./, "Thanks so much!")
    .replace(/Thanks for getting in touch\./, "Thanks for reaching out!")
    .replace(/Kind regards,\n/, "Cheers,\n");
}
