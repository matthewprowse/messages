// EXAMPLE content for the setup dialog: a made-up merge to decide and a practice message to reply to. It
// exists to show what Konva does, so every screen that uses it says "Example". Nothing here is ever written
// to the profile, the database or an outbox; real findings come from lib/onboarding-findings.ts.

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const capital = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
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
