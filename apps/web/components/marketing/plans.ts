// What each plan includes, for the plan cards on Home and Pricing and the comparison table on Pricing. Prices come
// from lib/site.ts.

import { PRICES } from "@/lib/site";

export interface Plan {
  name: string;
  /** Rand a month, paid monthly and paid yearly. */
  price: { monthly: number; yearly: number };
  per: string;
  blurb: string;
  /** The line above the list: what the list adds to. */
  includesTitle: string;
  includes: string[];
}

export const PLANS: Plan[] = [
  {
    name: "Individual",
    price: { monthly: PRICES.individual, yearly: PRICES.individualYearly },
    per: "a month",
    blurb: "For one agent, broker, adviser or recruiter with their own accounts.",
    includesTitle: "Includes",
    includes: [
      "Email, WhatsApp, LinkedIn and Instagram in one inbox",
      "Google, Outlook and iCloud calendars",
      "Priority and a one line summary on every conversation",
      "Drafts in your own voice",
      "A brief every morning",
      "Meeting notes and tasks from your conversations",
      "Encrypted per user, with two-factor sign in",
    ],
  },
  {
    name: "Team",
    price: { monthly: PRICES.seat, yearly: PRICES.seatYearly },
    per: "a seat a month",
    blurb: `For offices of ${PRICES.minSeats} or more that share their clients.`,
    includesTitle: "Everything in Individual, plus",
    includes: [
      "Client conversations shared with the office",
      "Personal chats kept private to each person",
      "Client history that stays when someone leaves",
      "Shared reply templates",
      "Seats and members managed by the owner",
      "Your office set up with you during the beta",
    ],
  },
];

/** The comparison table: each group's rows say whether Individual and Team have it, or give a short value. */
export const COMPARISON: { group: string; rows: { label: string; individual: boolean | string; team: boolean | string }[] }[] = [
  {
    group: "Inbox",
    rows: [
      { label: "Gmail, Outlook, iCloud and other email", individual: true, team: true },
      { label: "WhatsApp and WhatsApp Business", individual: true, team: true },
      { label: "LinkedIn and Instagram messages", individual: true, team: true },
      { label: "Google, Outlook and iCloud calendars", individual: true, team: true },
      { label: "One contact per person across channels", individual: true, team: true },
      { label: "Search across every conversation", individual: true, team: true },
      { label: "Snooze, reminders and follow ups", individual: true, team: true },
    ],
  },
  {
    group: "AI",
    rows: [
      { label: "Priority and Needs Reply on every conversation", individual: true, team: true },
      { label: "One line summaries", individual: true, team: true },
      { label: "Drafts in your own voice", individual: true, team: true },
      { label: "A brief every morning", individual: true, team: true },
      { label: "Meeting notes and summaries", individual: true, team: true },
      { label: "Tasks from your conversations", individual: true, team: true },
      { label: "Monthly AI allowance", individual: "Generous, fair usage", team: "Generous, fair usage" },
    ],
  },
  {
    group: "Teams",
    rows: [
      { label: "Client conversations shared with the office", individual: false, team: true },
      { label: "Personal chats kept private", individual: false, team: true },
      { label: "Client history stays when someone leaves", individual: false, team: true },
      { label: "Shared reply templates", individual: false, team: true },
      { label: "Seat and member management", individual: false, team: true },
    ],
  },
  {
    group: "Security",
    rows: [
      { label: "Message text encrypted with a key per user", individual: true, team: true },
      { label: "Two-factor sign in", individual: true, team: true },
      { label: "Download or delete all your data", individual: true, team: true },
    ],
  },
  {
    group: "Support",
    rows: [
      { label: "Replies within one working day", individual: true, team: true },
      { label: "Weekly group onboarding session", individual: true, team: true },
      { label: "Office setup with you during the beta", individual: false, team: true },
    ],
  },
];

export const PRICING_FAQ = [
  { q: "How does yearly billing work?", a: `Pay for a year at a time and save about 20%: R${PRICES.individualYearly} a month instead of R${PRICES.individual} for one person, or R${PRICES.seatYearly} a seat instead of R${PRICES.seat} for a team.` },
  { q: "Do prices include VAT?", a: "No. Prices are per month in rand and exclude VAT, which is added once Konva is VAT registered." },
  { q: "Why do teams start at 5 seats?", a: "The Team plan is built for offices that share their clients. One or two people can each take the Individual plan." },
  { q: "What counts as a seat?", a: "Each person in your office who signs in to Konva." },
  { q: "Is there a limit on the AI?", a: "Every plan includes a generous monthly AI allowance for drafts, summaries, the brief and meetings. Fair usage applies, and Settings shows how much you have used." },
  { q: "Can I try it first?", a: "Konva is in a closed beta. Offices that join the beta start with 30 days free while we set Konva up with them." },
  { q: "Can I leave with my data?", a: "Yes. You can download everything Konva holds for you, or delete your account and all of it, from Settings at any time." },
];
