// The made-up inbox the browser tests run against: one email account that is connected to nothing, people at the
// reserved example domains (they can never receive mail), and the email conversations with the AI's work already on them,
// as the AI worker would have left it. seed-email.ts writes it the way the sync worker writes real mail. WhatsApp chats are
// in fake-chats.ts, and labels, tasks, events and the brief in fake-extras.ts. Every name, address and line here is invented.

/** The fake mailbox: an example.com address with no sign-in stored, so nothing could ever be sent through it. */
export const ACCOUNT = { provider: "imap", label: "Work Email", address: "konva-e2e-inbox@example.com" } as const;

export interface FakePerson {
  name: string;
  address: string;
}

export const PEOPLE: FakePerson[] = [
  { name: "Ava Thompson", address: "ava.thompson@example.com" },
  { name: "Ben Carter", address: "ben.carter@example.org" },
  { name: "Chloe Naidoo", address: "chloe.naidoo@example.net" },
  { name: "Daniel Mokoena", address: "daniel.mokoena@example.com" },
  { name: "Emma Fischer", address: "emma.fischer@example.org" },
  { name: "Farid Patel", address: "farid.patel@example.net" },
  { name: "Design Weekly", address: "news@example.net" },
  { name: "Prize Desk", address: "prizes@example.org" },
  { name: "Accounts Team", address: "accounts.team@example.net" },
  { name: "Hannah Louw", address: "hannah.louw@example.com" },
];

export interface FakeMessage {
  /** "me" for a message the user sent, else the index of the sender in PEOPLE. */
  from: "me" | number;
  body: string;
  /** How long before the seed ran it was sent, so the list order is fixed and recent. */
  minutesAgo: number;
  /** Unread when it arrived and nobody has opened it yet. Only for incoming messages. */
  unread?: boolean;
}

export type Priority = "urgent" | "important" | "normal" | "low";
export type Category = "personal" | "work" | "needs_reply" | "fyi" | "newsletter" | "notification";

/** One-tap reply choices as triage stores them (apps/ai/ai/triage_prompt.py read_choices): options, and a plan for Add to Calendar. */
export interface FakeChoices {
  options: { label: string; decision: string; kind: "accept" | "decline" | "other_time" | "answer" }[];
  /** start is "YYYY-MM-DD" (all day) or "YYYY-MM-DDTHH:MM"; end is "" when the message gave none. */
  plan?: { title: string; start: string; end: string; place: string };
}

/** What the AI worker leaves on a conversation and on its latest incoming message. */
export interface FakeAi {
  priority: Priority;
  category: Category;
  summary: string;
  needsReply?: boolean;
  junk?: boolean;
  /** A warning on the conversation: payment_change, phishing or impersonation. */
  suspicious?: "payment_change" | "phishing" | "impersonation";
  choices?: FakeChoices;
}

export interface FakeConversation {
  /** A short name the tests use to pick a conversation. */
  key: string;
  subject: string;
  /** The person the conversation is with (index in PEOPLE). */
  with: number;
  messages: FakeMessage[];
  ai?: FakeAi;
  /** Names of labels (fake-extras.ts LABELS) the conversation wears. */
  labels?: string[];
  /** Archived by the user. */
  archived?: boolean;
  /** Snoozed until this many days from now. */
  snoozedDays?: number;
  /** An AI draft waiting in the reply box. */
  draft?: string;
  /** The user's last message expects an answer (a follow_ups row), for the Waiting filter. */
  waiting?: boolean;
  /** A bulk sender: the List-Unsubscribe header, which makes it a Subscription. */
  listUnsubscribe?: string;
}

const HOUR = 60;
const DAY = 24 * HOUR;

export const CONVERSATIONS: FakeConversation[] = [
  { key: "kitchen", subject: "Kitchen Renovation Quote", with: 0, labels: ["Clients"],
    ai: { priority: "urgent", category: "work", needsReply: true, summary: "Ava wants the kitchen quote with the oak worktops as a separate line." },
    messages: [
      { from: 0, body: "Hi, could you send a quote for the kitchen renovation we discussed on site?", minutesAgo: 2 * DAY },
      { from: "me", body: "Of course. I will have the full quote with you by Thursday.", minutesAgo: 2 * DAY - 90 },
      { from: 0, body: "Thanks. Please include the cost of the oak worktops as a separate line.", minutesAgo: 25, unread: true },
    ] },
  { key: "lease", subject: "Lease Renewal for Unit 4B", with: 1,
    ai: { priority: "important", category: "work", needsReply: true, summary: "Ben needs an answer on renewing the lease by Friday." },
    draft: "Hi Ben, yes, let us renew on the same terms. Please send the paperwork through.",
    messages: [
      { from: 1, body: "The lease for Unit 4B ends next month. Shall we renew on the same terms?", minutesAgo: 3 * DAY },
      { from: 1, body: "Just following up on the renewal, the landlord needs an answer by Friday.", minutesAgo: 50, unread: true },
    ] },
  { key: "tax", subject: "Quarterly Tax Documents", with: 2,
    ai: { priority: "normal", category: "fyi", summary: "Chloe sent the July to September receipts, sorted by month." },
    messages: [
      { from: "me", body: "Please could you send the receipts for the last quarter when you have a moment?", minutesAgo: 4 * DAY },
      { from: 2, body: "Attached are the receipts for July to September, sorted by month.", minutesAgo: 80, unread: true },
    ] },
  { key: "wedding", subject: "Wedding Photography Booking", with: 3, labels: ["Clients"],
    ai: {
      priority: "important", category: "personal", needsReply: true, summary: "Daniel wants to book you for his wedding on 14 March.",
      choices: {
        options: [
          { label: "Accept", decision: "I would be happy to photograph the wedding on the fourteenth of March.", kind: "accept" },
          { label: "Decline", decision: "I am sorry, I am not available on the fourteenth of March.", kind: "decline" },
        ],
        plan: { title: "Wedding Photography", start: "2027-03-14", end: "", place: "Stellenbosch Estate" },
      },
    },
    messages: [{ from: 3, body: "We would love to book you for our wedding on the fourteenth of March.", minutesAgo: 5 * HOUR, unread: true }] },
  { key: "shoot", subject: "Portrait Shoot Availability", with: 3,
    ai: {
      priority: "normal", category: "personal", needsReply: true, summary: "Daniel asks whether you can do a portrait shoot on Saturday.",
      choices: { options: [
        { label: "Accept", decision: "I would be glad to do the portrait shoot on Saturday.", kind: "accept" },
        { label: "Decline", decision: "I am sorry, I cannot do the portrait shoot on Saturday.", kind: "decline" },
      ] },
    },
    messages: [{ from: 3, body: "Are you free for a portrait shoot this Saturday?", minutesAgo: 20 * HOUR, unread: true }] },
  { key: "website", subject: "Website Redesign Feedback", with: 4,
    ai: { priority: "normal", category: "work", summary: "Emma is happy with the new homepage on her phone." },
    messages: [
      { from: 4, body: "The new homepage looks great. Could the contact button be a little larger?", minutesAgo: 1 * DAY },
      { from: "me", body: "Good idea, I have made it larger and moved it above the fold.", minutesAgo: 1 * DAY - 30 },
      { from: 4, body: "Perfect, that works much better on my phone.", minutesAgo: 1 * DAY - 120 },
    ] },
  { key: "invoice", subject: "Invoice 2041 Query", with: 5, waiting: true,
    messages: [
      { from: 5, body: "Invoice 2041 shows two call outs but I only remember one visit.", minutesAgo: 2 * DAY + 3 * HOUR },
      { from: "me", body: "You are right, the second line was a mistake. A corrected invoice is on its way.", minutesAgo: 2 * DAY + HOUR },
    ] },
  { key: "offsite", subject: "Team Offsite Venue", with: 0,
    messages: [
      { from: 0, body: "Two venues are free on the date we picked. Do you prefer the farm or the lodge?", minutesAgo: 3 * DAY + 2 * HOUR },
      { from: "me", body: "The lodge, please. It is closer for everyone driving in.", minutesAgo: 3 * DAY },
    ] },
  { key: "insurance", subject: "Insurance Claim Update", with: 1,
    ai: { priority: "normal", category: "fyi", summary: "Ben says the claim is approved and the assessor visits Monday." },
    messages: [{ from: 1, body: "Your claim has been approved and the assessor will visit on Monday morning.", minutesAgo: 4 * DAY + 5 * HOUR }] },
  { key: "garden", subject: "Garden Service Schedule", with: 2,
    messages: [
      { from: 2, body: "From next week the garden service moves to Wednesdays.", minutesAgo: 5 * DAY },
      { from: "me", body: "Wednesdays suit us well, thank you for letting me know.", minutesAgo: 5 * DAY - 45 },
    ] },
  { key: "consultation", subject: "Consultation Follow Up", with: 3,
    messages: [
      { from: 3, body: "Thank you for the consultation yesterday. What are the next steps?", minutesAgo: 6 * DAY },
      { from: "me", body: "I will send a written plan and a timeline by the end of the week.", minutesAgo: 6 * DAY - 60 },
    ] },
  // Triage results the list and the conversation show differently: a warning, spam, a newsletter, archived, snoozed.
  { key: "scam", subject: "Updated Banking Details", with: 8,
    ai: { priority: "normal", category: "fyi", suspicious: "payment_change", summary: "Asks you to pay a new bank account from now on." },
    messages: [{ from: 8, body: "Our bank account has changed. Please send all future payments to the new account below.", minutesAgo: 7 * HOUR, unread: true }] },
  { key: "prize", subject: "You Have Won a Free Cruise", with: 7,
    ai: { priority: "low", category: "notification", junk: true, summary: "" },
    messages: [{ from: 7, body: "Congratulations, you have been chosen for a free cruise. Reply today to claim it.", minutesAgo: 9 * HOUR, unread: true }] },
  { key: "news", subject: "Weekly Design Digest", with: 6, listUnsubscribe: "<mailto:unsubscribe@example.net>",
    ai: { priority: "low", category: "newsletter", junk: true, summary: "" },
    // Unopened for over 90 days, so Clean Up offers the sender.
    messages: [{ from: 6, body: "This week in design: five layouts that work, and a reader's redesign of a train timetable.", minutesAgo: 100 * DAY, unread: true }] },
  { key: "archived", subject: "Old Project Handover", with: 9, archived: true,
    messages: [{ from: 9, body: "The handover notes for the old project are in the shared folder.", minutesAgo: 8 * DAY }] },
  { key: "snoozed", subject: "Contract Draft Review", with: 9, snoozedDays: 3,
    messages: [{ from: 9, body: "Could you look over the contract draft when you are back?", minutesAgo: 10 * HOUR }] },
  // One conversation for each test that changes something, so the three projects and the tests never meet in one.
  { key: "trash", subject: "Parking Permit Renewal", with: 9, messages: [{ from: 9, body: "Your parking permit is due for renewal next month.", minutesAgo: 11 * HOUR }] },
  { key: "labelled", subject: "Gym Membership Renewal", with: 5, messages: [{ from: 5, body: "Your gym membership renews at the end of the month.", minutesAgo: 12 * HOUR }] },
  { key: "snooze", subject: "Dentist Appointment", with: 4, messages: [{ from: 4, body: "Your dentist appointment is booked for the second of December.", minutesAgo: 13 * HOUR }] },
  { key: "archive", subject: "Book Club Choice", with: 2, messages: [{ from: 2, body: "This month the club is reading a short novel set in Lisbon.", minutesAgo: 14 * HOUR }] },
  { key: "bulk1", subject: "Quarterly Review Meeting", with: 1, messages: [{ from: 1, body: "The quarterly review is on Tuesday at ten.", minutesAgo: 15 * HOUR, unread: true }] },
  { key: "bulk2", subject: "Flight Confirmation", with: 0, messages: [{ from: 0, body: "Your flight to Durban is confirmed for the twentieth.", minutesAgo: 16 * HOUR, unread: true }] },
  { key: "live", subject: "Roof Inspection Report", with: 4, messages: [{ from: 4, body: "The roof inspection found two loose tiles near the chimney.", minutesAgo: 17 * HOUR }] },
  { key: "offline", subject: "Solar Panel Quote", with: 3, messages: [{ from: 3, body: "Here is the quote for the solar panels we talked about.", minutesAgo: 18 * HOUR }] },
];

/** A conversation by its key. Throws on a key that is not in CONVERSATIONS. */
export function conversation(key: string): FakeConversation {
  const found = CONVERSATIONS.find((c) => c.key === key);
  if (!found) throw new Error(`No fake conversation named ${key}.`);
  return found;
}

/** Whether a conversation is unread once seeded: its latest incoming message is. */
export const isUnread = (c: FakeConversation) => c.messages.some((m) => m.unread);

/** The last message of a conversation, the one the AI's work is stored against when it is incoming. */
export const lastMessage = (c: FakeConversation) => c.messages[c.messages.length - 1];
