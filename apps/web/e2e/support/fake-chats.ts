// The made-up WhatsApp chats: one account that is connected to nothing (no session is stored, so nothing could be sent),
// people on obviously fake numbers (the 555 01xx range is reserved for fiction), a one to one chat, a group, and a chat the
// realtime tests add to. seed-whatsapp.ts writes them the way the sync worker's WhatsApp connector does. All invented.

export const WA_ACCOUNT = { provider: "whatsapp", label: "WhatsApp", phone: "+15555550100" } as const;

export interface FakeContact {
  name: string;
  /** E.164, the form the connector stores. */
  phone: string;
}

export const WA_PEOPLE: FakeContact[] = [
  { name: "Grace Dlamini", phone: "+15555550101" },
  { name: "Hendrik Botha", phone: "+15555550102" },
  { name: "Iris Chen", phone: "+15555550103" },
  { name: "Jonas Smit", phone: "+15555550104" },
];

export interface FakeChatMessage {
  /** "me" for a message the user sent, else the index of the sender in WA_PEOPLE. */
  from: "me" | number;
  body: string;
  minutesAgo: number;
  unread?: boolean;
}

export interface FakeChat {
  key: string;
  /** The chat's JID as WhatsApp names it: the number for a person, a long id for a group. */
  jid: string;
  /** Set for a group: its name, and the people in it (indexes in WA_PEOPLE). */
  group?: { name: string; members: number[] };
  /** The other person of a one to one chat (index in WA_PEOPLE). */
  with?: number;
  messages: FakeChatMessage[];
}

export const CHATS: FakeChat[] = [
  { key: "grace", jid: "15555550101@s.whatsapp.net", with: 0, messages: [
    { from: 0, body: "Are we still on for coffee on Saturday morning?", minutesAgo: 2 * 24 * 60 },
    { from: "me", body: "Yes, nine o'clock at the usual place.", minutesAgo: 2 * 24 * 60 - 20 },
    { from: 0, body: "Perfect, see you then. I will bring the photos.", minutesAgo: 20, unread: true },
  ] },
  { key: "hike", jid: "120363000000000001@g.us", group: { name: "Weekend Hike Crew", members: [1, 2] }, messages: [
    { from: 1, body: "I have booked the trail for Sunday morning.", minutesAgo: 3 * 60 },
    { from: "me", body: "Great, I can drive if we leave by seven.", minutesAgo: 3 * 60 - 10 },
    { from: 2, body: "Seven is fine, I will bring the snacks.", minutesAgo: 35, unread: true },
  ] },
  { key: "jonas", jid: "15555550104@s.whatsapp.net", with: 3, messages: [
    { from: 3, body: "Did the delivery arrive at the shop today?", minutesAgo: 6 * 60 },
  ] },
];

/** A chat by its key. Throws on a key that is not in CHATS. */
export function chat(key: string): FakeChat {
  const found = CHATS.find((c) => c.key === key);
  if (!found) throw new Error(`No fake chat named ${key}.`);
  return found;
}
