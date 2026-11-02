// A WhatsApp poll from what is stored: the question and options come out of the message text, and the vote counts out of the
// positions kept on the message (provider_meta.poll_votes). Pure; the worker's apps/worker/src/whatsapp/polls.ts is the writer.

export interface PollView {
  name: string;
  options: { text: string; votes: number }[];
  /** People who have voted at all. */
  voters: number;
}

/** The poll in a message's text ("Poll: question" then one "• option" per line), or null when the text is not a poll. */
export function parsePoll(body: string): { name: string; options: string[] } | null {
  const [first, ...rest] = body.split("\n");
  if (!first?.startsWith("Poll: ")) return null;
  return { name: first.slice("Poll: ".length), options: rest.filter((l) => l.startsWith("• ")).map((l) => l.slice(2)) };
}

/** The poll with a vote count per option. Each person counts once per option; a position that is not an option is ignored. */
export function pollView(body: string, votes: Record<string, number[]> = {}): PollView | null {
  const poll = parsePoll(body);
  if (!poll) return null;
  const counts = poll.options.map(() => 0);
  let voters = 0;
  for (const picks of Object.values(votes)) {
    const own = new Set(picks.filter((i) => Number.isInteger(i) && i >= 0 && i < counts.length));
    if (own.size) voters++;
    for (const i of own) counts[i]++;
  }
  return { name: poll.name, options: poll.options.map((text, i) => ({ text, votes: counts[i] })), voters };
}
