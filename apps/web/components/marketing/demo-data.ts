// Made up conversations for the marketing site's product pictures: a morning in each trade the site speaks to. No real
// people or companies; the avatars and logos are drawn in public/demo. Times are relative to `now`, so rows read as today.

import type { Channel, Contact, Message, Provider, Thread } from "@/lib/types";

const MIN = 60_000; // ms
const DAY = 1440; // minutes

/** The trades with their own page and their own demo inbox. */
export type DemoKey = "estate" | "brokers" | "attorneys" | "recruiters";

/** One trade's inbox: who is in it, the list, the conversation shown open and the reply Konva drafted for it. */
export interface DemoSet {
  contacts: Record<string, Contact>;
  threads: (now: number) => Thread[];
  /** The open conversation: its thread id, how its header names the channel and whether it is a WhatsApp chat. */
  open: { id: string; channel: string; provider: Provider; whatsapp: boolean };
  messages: (now: number) => Message[];
  draft: string;
  /** The rows the Priority picture shows, in order. */
  priority: string[];
  /** Rows the live hero holds back and lands at the top one by one, in order (use-live-demo.ts). */
  incoming?: string[];
}

function person(id: string, name: string, isCompany = false): Contact {
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2);
  return { id, name, initials, hue: 0, emails: [], phones: [], isCompany, avatarPath: `/demo/${id}.svg` };
}

type Row = { id: string; who: string; channel: Channel; provider: Provider; mins: number; text: string; summary: string; unread?: number; urgent?: boolean; reply?: boolean; mine?: boolean };

function rows(list: Row[]) {
  return (now: number): Thread[] => list.map((r) => ({
    id: r.id, channel: r.channel, provider: r.provider, participantIds: [r.who],
    lastMessageAt: new Date(now - r.mins * MIN).toISOString(),
    // Email rows show the subject, chats the latest message, as in the app.
    ...(r.channel === "email" ? { subject: r.text } : { preview: r.text }),
    unread: !!r.unread, unreadCount: r.unread ?? 0, pinned: false, status: "inbox",
    priority: r.urgent ? "urgent" : r.reply ? "important" : "normal", category: "work",
    summary: r.summary, needsReply: !!r.reply, lastFromMe: !!r.mine, junk: false, subscription: false,
  }));
}

type Line = [from: string, minsAgo: number, body: string];

function chat(threadId: string, whatsapp: boolean, lines: Line[]) {
  return (now: number): Message[] => lines.map(([from, mins, body], i) => ({
    id: `${threadId}-${i}`, threadId, from, body, whatsapp,
    sentAt: new Date(now - mins * MIN).toISOString(),
    ...(from === "me" && whatsapp ? { receipt: "read" as const } : {}),
  }));
}

const contacts = (list: [string, string, boolean?][]) => Object.fromEntries(list.map(([id, name, co]) => [id, person(id, name, co)]));

const estate: DemoSet = {
  contacts: contacts([["thandi", "Thandi Mokoena"], ["pieter", "Pieter van Wyk"], ["portal", "Property Portal Leads", true], ["naledi", "Naledi Dlamini"], ["james", "James Carter"], ["bond", "Coastal Bond Originators", true], ["ayesha", "Ayesha Khan"]]),
  threads: rows([
    { id: "e1", who: "thandi", channel: "whatsapp", provider: "whatsapp", mins: 4, unread: 2, reply: true, text: "Also, are pets allowed? We have a small dog 🐶", summary: "Wants a Saturday morning viewing of the Sea Point flat and asks if pets are allowed." },
    { id: "e2", who: "pieter", channel: "email", provider: "gmail", mins: 18, unread: 1, urgent: true, reply: true, text: "Signed Offer to Purchase: 14 Kloof Street", summary: "Signed offer attached. Needs the seller's answer before Friday 12:00." },
    { id: "e3", who: "portal", channel: "email", provider: "outlook", mins: 42, unread: 1, reply: true, text: "New Enquiry: 3 Bedroom House in Durbanville", summary: "New buyer lead with a pre-approved bond, looking to move in March." },
    { id: "e4", who: "naledi", channel: "whatsapp", provider: "whatsapp", mins: 75, text: "Thank you so much! We'll come in tomorrow to sign.", summary: "Coming in tomorrow to sign the lease." },
    { id: "e5", who: "james", channel: "linkedin", provider: "linkedin", mins: 130, reply: true, text: "Relocating to Cape Town in January. Could you help us find a rental near good schools?", summary: "Relocating in January, wants a family rental near schools." },
    { id: "e6", who: "bond", channel: "email", provider: "gmail", mins: 220, mine: true, text: "Bond Approval: Mokoena Purchase", summary: "Bond approved. Waiting on the transfer attorney." },
    { id: "e7", who: "ayesha", channel: "instagram", provider: "instagram", mins: 300, reply: true, text: "Loved the reel of the Camps Bay listing 😍 What's the asking price?", summary: "Asking the price of the Camps Bay listing." },
  ]),
  open: { id: "e1", channel: "WhatsApp", provider: "whatsapp", whatsapp: true },
  messages: chat("e1", true, [
    ["thandi", DAY + 30, "Hi! I saw the 2 bedroom flat in Sea Point on your listings. Is it still available?"],
    ["me", DAY + 22, "Hi Thandi, it is! It's R18,500 a month, available from 1 December. Would you like to see it?"],
    ["thandi", 6, "Yes please! Could we view it on Saturday morning?"],
    ["thandi", 4, "Also, are pets allowed? We have a small dog 🐶"],
  ]),
  draft: "Saturday works! I have 9:30 or 11:00 open. The owner is happy with a small dog, so that's no problem. Which time suits you?",
  priority: ["e2", "e1", "e3", "e5"],
  incoming: ["e3", "e2"],
};

const brokers: DemoSet = {
  contacts: contacts([["lerato", "Lerato Nkosi"], ["summit", "Summit Life", true], ["johan", "Johan Botha"], ["priya", "Priya Naidoo"], ["meridian", "Meridian Medical Scheme", true], ["sipho", "Sipho Mahlangu"]]),
  threads: rows([
    { id: "b1", who: "lerato", channel: "whatsapp", provider: "whatsapp", mins: 7, unread: 2, urgent: true, reply: true, text: "The other driver left his number. What do I need to do to claim?", summary: "Car hit in a parking lot this morning. Asking how to claim; the other driver left his number." },
    { id: "b2", who: "summit", channel: "email", provider: "outlook", mins: 35, unread: 1, reply: true, text: "Policy Renewal: Botha Family Cover, Due 1 December", summary: "Renewal terms for the Botha family cover. Premium goes up 6% unless changed by 25 November." },
    { id: "b3", who: "johan", channel: "email", provider: "gmail", mins: 90, unread: 1, reply: true, text: "Re: Retirement Annuity Top Up", summary: "Wants to add R50,000 to his retirement annuity before February." },
    { id: "b4", who: "priya", channel: "whatsapp", provider: "whatsapp", mins: 160, text: "Thanks, the medical aid change went through 🙌", summary: "Confirms the medical aid change went through." },
    { id: "b5", who: "sipho", channel: "linkedin", provider: "linkedin", mins: 240, reply: true, text: "Would you have time to look at group cover for our 40 staff?", summary: "Asking for a group cover quote for a company of 40." },
    { id: "b6", who: "meridian", channel: "email", provider: "outlook", mins: 380, text: "Benefit Changes for 2027", summary: "Scheme benefit changes for next year. Nothing to do yet." },
  ]),
  open: { id: "b1", channel: "WhatsApp", provider: "whatsapp", whatsapp: true },
  messages: chat("b1", true, [
    ["lerato", 3 * DAY, "Thanks for sorting out the cover for the new car!"],
    ["me", 3 * DAY - 5, "Pleasure, Lerato. Shout if you ever need anything."],
    ["lerato", 9, "Hi, my car was hit in a parking lot this morning 😩"],
    ["lerato", 7, "The other driver left his number. What do I need to do to claim?"],
  ]),
  draft: "So sorry, Lerato. I hope you're okay. Please send me photos of the damage, the other driver's details and a case number if you reported it, and I'll open the claim today.",
  priority: ["b1", "b2", "b3", "b5"],
};

const attorneys: DemoSet = {
  contacts: contacts([["michael", "Michael Petersen"], ["vdm", "Van der Merwe Inc.", true], ["zanele", "Zanele Khumalo"], ["grace", "Grace Mthembu"], ["kloof", "Kloof Conveyancers", true], ["daniel", "Daniel Fourie"]]),
  threads: rows([
    { id: "a1", who: "michael", channel: "whatsapp", provider: "whatsapp", mins: 12, unread: 2, reply: true, text: "The movers need to know by Friday.", summary: "Asking for the transfer date. The movers need an answer by Friday." },
    { id: "a2", who: "vdm", channel: "email", provider: "outlook", mins: 28, unread: 1, urgent: true, reply: true, text: "Draft Settlement Agreement: Ndlovu v Ndlovu", summary: "Draft settlement for comment. They want your client's position by Wednesday." },
    { id: "a3", who: "grace", channel: "email", provider: "gmail", mins: 65, unread: 1, reply: true, text: "Question About My Late Father's Estate", summary: "Her father passed away last month. Asking what the first steps are with his estate." },
    { id: "a4", who: "zanele", channel: "email", provider: "gmail", mins: 140, text: "Signed Power of Attorney", summary: "Signed power of attorney attached." },
    { id: "a5", who: "kloof", channel: "email", provider: "outlook", mins: 210, text: "Lodgement Confirmed: Erf 4412 Rondebosch", summary: "Transfer lodged on Monday." },
    { id: "a6", who: "daniel", channel: "linkedin", provider: "linkedin", mins: 320, reply: true, text: "Do you handle commercial lease disputes?", summary: "Possible new client with a commercial lease dispute." },
  ]),
  open: { id: "a1", channel: "WhatsApp", provider: "whatsapp", whatsapp: true },
  messages: chat("a1", true, [
    ["me", 6 * DAY, "Hi Michael, all the transfer documents are signed. We'll lodge at the Deeds Office this week."],
    ["michael", 6 * DAY - 40, "Great, thanks!"],
    ["michael", 14, "Morning! Any news on the transfer date?"],
    ["michael", 12, "The movers need to know by Friday."],
  ]),
  draft: "Morning Michael, good news: the transfer was lodged on Monday. Registration usually follows within about 10 working days, so plan for the week of the 17th. I'll let you know the moment it registers.",
  priority: ["a2", "a1", "a3", "a6"],
};

const recruiters: DemoSet = {
  contacts: contacts([["kagiso", "Kagiso Molefe"], ["harbour", "Harbour Logistics", true], ["megan", "Megan Adams"], ["tumi", "Tumi Sithole"], ["ruan", "Ruan Botha"], ["board", "Talent Board", true]]),
  threads: rows([
    { id: "r1", who: "kagiso", channel: "linkedin", provider: "linkedin", mins: 5, unread: 2, reply: true, text: "I'd be open to hearing more. Is it hybrid?", summary: "Interested in the Senior Accountant role and asks if it is hybrid." },
    { id: "r2", who: "harbour", channel: "email", provider: "outlook", mins: 24, unread: 1, urgent: true, reply: true, text: "Shortlist Feedback: Senior Accountant", summary: "Wants two of the three candidates in for interviews this week." },
    { id: "r3", who: "ruan", channel: "whatsapp", provider: "whatsapp", mins: 50, unread: 1, reply: true, text: "Could we move tomorrow's interview to the afternoon?", summary: "Asks to move tomorrow's interview to the afternoon." },
    { id: "r4", who: "tumi", channel: "whatsapp", provider: "whatsapp", mins: 95, text: "I got the offer!! Thank you so much 🎉", summary: "Accepted the offer." },
    { id: "r5", who: "megan", channel: "email", provider: "gmail", mins: 170, reply: true, text: "Re: Interview Thursday 10:00", summary: "Confirms Thursday and asks who she will meet." },
    { id: "r6", who: "board", channel: "email", provider: "gmail", mins: 260, text: "3 New Applicants: Data Engineer", summary: "Three new applicants for the Data Engineer role." },
  ]),
  open: { id: "r1", channel: "LinkedIn", provider: "linkedin", whatsapp: false },
  messages: chat("r1", false, [
    ["me", DAY + 120, "Hi Kagiso, I'm recruiting for a Senior Accountant role in Cape Town and your experience looks like a great fit. Would you be open to a chat?"],
    ["kagiso", 7, "Thanks for reaching out!"],
    ["kagiso", 5, "I'd be open to hearing more. Is it hybrid?"],
  ]),
  draft: "Great to hear, Kagiso! It's hybrid, three days in the office, at a logistics group in Cape Town, reporting to the Financial Director. Do you have 15 minutes on Thursday or Friday for a quick call?",
  priority: ["r2", "r1", "r3", "r5"],
};

/** Every trade's demo inbox. */
export const DEMO_SETS: Record<DemoKey, DemoSet> = { estate, brokers, attorneys, recruiters };
