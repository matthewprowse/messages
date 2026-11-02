// A WhatsApp poll inside its bubble: the question, each option with its vote count and a bar, and how many people have voted.
// Read only; votes are made in WhatsApp. The counts come from lib/poll.ts.

import type { Message } from "@/lib/types";
import { pollView } from "@/lib/poll";
import { Progress } from "@/components/ui/progress";

/** Null when the message is not a poll, so the bubble falls back to its text. */
export function PollCard({ m }: { m: Message }) {
  const poll = m.poll ? pollView(m.body, m.poll.votes) : null;
  if (!poll) return null;
  const top = Math.max(1, ...poll.options.map((o) => o.votes));
  return (
    <div className="flex min-w-48 flex-col gap-3">
      <p className="font-medium">{poll.name}</p>
      <ul className="flex flex-col gap-2">
        {poll.options.map((o, i) => (
          <li key={i} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="break-words">{o.text}</span>
              <span className="shrink-0 text-xs opacity-70">{o.votes}</span>
            </div>
            <Progress value={(o.votes / top) * 100} aria-label={`${o.votes} ${o.votes === 1 ? "vote" : "votes"} for ${o.text}`} />
          </li>
        ))}
      </ul>
      <p className="text-xs opacity-70">{poll.voters === 0 ? "No Votes Yet" : `${poll.voters} ${poll.voters === 1 ? "Person" : "People"} Voted`}{m.poll?.multi ? " · Several Answers Allowed" : ""}</p>
    </div>
  );
}
