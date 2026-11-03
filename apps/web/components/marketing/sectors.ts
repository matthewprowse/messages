// The trades Konva is built for, as the home page's Industries section shows them: a headline in each trade's words,
// a line on how it uses Konva, three things it gets, and which demo inbox (demo-data.ts) goes beside it.

import type { DemoKey } from "./demo-data";

export interface Sector {
  key: DemoKey;
  name: string;
  /** One line under the name in the list. */
  short: string;
  title: string;
  text: string;
  points: string[];
}

export const SECTORS: Sector[] = [
  {
    key: "estate",
    name: "Estate Agents",
    short: "Portal leads, WhatsApp and show days",
    title: "Reply to Every Lead in Minutes, Even on a Show Day",
    text: "Portal enquiries arrive by email, buyers move to WhatsApp and Instagram fills up with questions about your listings. Konva shows which leads are waiting and has the reply drafted while you are still at the viewing.",
    points: ["New portal leads marked the moment they land", "Buyers and sellers kept as one person across apps", "The office keeps the client when an agent moves on"],
  },
  {
    key: "brokers",
    name: "Brokers and Advisers",
    short: "Claims, renewals and advice questions",
    title: "Answer the Claim First, Not the Newsletter",
    text: "Claims come in on WhatsApp, renewals by email and advice questions everywhere in between. Konva puts the urgent ones first, sums each up in a line and keeps every client's history together.",
    points: ["Urgent claims at the top, with what happened", "Renewal deadlines kept in front of you until answered", "Every client conversation searchable in one place"],
  },
  {
    key: "attorneys",
    name: "Attorneys",
    short: "Matters, transfers and clients on WhatsApp",
    title: "Keep Every Client Informed, Without Living in Your Inbox",
    text: "Clients ask for news on WhatsApp, the other side emails a draft agreement and new matters arrive on LinkedIn. Konva summarises each thread in a line and drafts the update in your voice.",
    points: ["One line summary of where each matter stands", "Deadlines from the other side marked urgent", "Message text encrypted with a key of your own"],
  },
  {
    key: "recruiters",
    name: "Recruiters",
    short: "Candidates and hiring managers everywhere",
    title: "Reach the Best Candidate Before Anyone Else Does",
    text: "Candidates reply on LinkedIn, confirm interviews on WhatsApp and send CVs by email, while hiring managers want feedback yesterday. Konva keeps each person in one thread and the reply ready.",
    points: ["LinkedIn, email and WhatsApp under one candidate", "Hiring manager emails marked when they need you", "The agency keeps the pipeline when a consultant leaves"],
  },
];
