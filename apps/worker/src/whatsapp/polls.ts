// Poll votes. WhatsApp sends a vote as the SHA-256 of each option picked, encrypted with a key only the poll's message carries
// (messageSecret). The poll is stored with that key sealed in provider_meta.poll.secret; a vote is opened with it, matched back
// to option positions and kept on the poll as provider_meta.poll_votes {"<who>": [positions]} (public.whatsapp_poll_vote).
// Positions, not option text, are what is stored per vote. Pure: the connector does the reading and writing.

import { createHash } from "node:crypto";

/** The question and options out of the text kept for a poll (normalize.ts pollText). Null when it is not a poll. */
export function parsePollText(text: string): { name: string; options: string[] } | null {
  const [first, ...rest] = text.split("\n");
  if (!first?.startsWith("Poll: ")) return null;
  const options = rest.filter((l) => l.startsWith("• ")).map((l) => l.slice(2));
  return { name: first.slice("Poll: ".length), options };
}

/** WhatsApp identifies a picked option by the SHA-256 of its text, as hex. */
export function optionHash(option: string): string {
  return createHash("sha256").update(option).digest("hex");
}

/**
 * The positions (0 based) of the options a vote picked, in poll order. A hash that matches no option is ignored, so an
 * option list that changed or a damaged vote costs a vote, not a wrong one. Several picks of one option count once.
 */
export function selectedPositions(options: string[], picked: (Uint8Array | Buffer)[]): number[] {
  const wanted = new Set(picked.map((p) => Buffer.from(p).toString("hex")));
  return options.flatMap((o, i) => (wanted.has(optionHash(o)) ? [i] : []));
}

/** The same vote tallied: for each option, how many people picked it. Used by tests and mirrored by the app. */
export function tally(optionCount: number, votes: Record<string, number[]>): number[] {
  const counts = Array.from({ length: optionCount }, () => 0);
  for (const picks of Object.values(votes)) for (const i of new Set(picks)) if (i >= 0 && i < optionCount) counts[i]++;
  return counts;
}
