// Pure pieces of the conversation header and Forward: who the conversation is with, its subtitle, the member list of a
// group, and the quoted body of a forward. No React; thread-view/ uses them and thread-header.test.ts pins them down.

import type { Contact, Message, Thread } from "./types";
import { formatPhone, fullStamp, niceName } from "./format";

/** A forward of the latest message: its subject and the message quoted below an empty space for a note. */
export function forwardDraft(thread: Thread, msgs: Message[]) {
  const m = [...msgs].reverse().find((x) => !x.sendState && !x.deleted);
  const subject = thread.subject?.trim() ?? "";
  const lines = [
    "",
    "",
    "Begin forwarded message:",
    "",
    ...(m?.address ? [`From: ${m.address}`] : []),
    ...(m ? [`Date: ${fullStamp(m.sentAt)}`] : []),
    ...(subject ? [`Subject: ${subject}`] : []),
    "",
    m?.body ?? "",
  ];
  return { subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`.trim(), body: lines.join("\n") };
}

const phoneOf = (n: string | undefined) => (n ? formatPhone(n) : undefined);

/** The name, subtitle and contact shown at the top of a conversation. */
export function headerOf(thread: Thread, msgs: Message[], contactById: (id: string) => Contact | undefined) {
  const primary = thread.isGroup ? undefined : contactById(thread.participantIds[0]);
  const title = niceName((thread.isGroup ? thread.groupName : primary?.name ?? thread.fallbackName) ?? "Unknown");
  // Who you are really talking to: the address their latest message came from, or their number.
  let lastAddress: string | undefined;
  for (let i = msgs.length - 1; i >= 0 && !lastAddress; i--) if (msgs[i].from !== "me") lastAddress = msgs[i].address;
  const subtitle = thread.isGroup
    ? groupMembers(thread.participantIds, msgs, contactById)
    : thread.channel === "email"
      ? lastAddress ?? primary?.emails[0]
      : thread.channel === "instagram"
        ? primary?.handles?.[0] && `@${primary.handles[0]}`
        : phoneOf(primary?.phones[0] ?? (lastAddress?.includes("@") ? undefined : lastAddress));
  return { primary, title, subtitle };
}

/** "Sarah, Tom and Lee": every person in a group, from its members and everyone who has written in it. */
export function groupMembers(participantIds: string[], msgs: Message[], contactById: (id: string) => { name: string } | undefined) {
  const ids = new Set(participantIds);
  for (const m of msgs) if (m.from !== "me" && m.from !== "unknown") ids.add(m.from);
  const names = [...ids].map((id) => contactById(id)?.name?.trim()).filter((n): n is string => !!n);
  if (names.length === 0) return undefined;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}
