// When a Business or Creator Instagram account may reply, as one pure rule the composer notice uses. It mirrors
// apps/ai/ai/connectors/instagram/window.py: 24 hours after their last message, or 7 days with the HUMAN_AGENT tag
// when Meta granted the app the Human Agent feature (INSTAGRAM_HUMAN_AGENT in apps/ai/.env, and
// NEXT_PUBLIC_INSTAGRAM_HUMAN_AGENT here: set both or neither). The connector enforces it again before sending.

export const STANDARD_MS = 24 * 3600_000;
export const HUMAN_AGENT_MS = 7 * 24 * 3600_000;

export type ReplyWindow = "open" | "human_agent" | "closed";

/** Whether a reply may go now, given when they last wrote (ms, 0 or less for never). */
export function replyWindow(lastFromThem: number, now: number, humanAgent: boolean): ReplyWindow {
  if (!(lastFromThem > 0)) return "closed";
  const age = now - lastFromThem;
  if (age < STANDARD_MS) return "open";
  return humanAgent && age < HUMAN_AGENT_MS ? "human_agent" : "closed";
}

/** When the window now open will close, so the composer can switch to the notice by itself. */
export function windowClosesAt(lastFromThem: number, now: number, humanAgent: boolean): number {
  const w = replyWindow(lastFromThem, now, humanAgent);
  if (w === "closed") return 0;
  return lastFromThem + (humanAgent ? HUMAN_AGENT_MS : STANDARD_MS);
}

/** The build-time switch for Human Agent in the browser. */
export const humanAgentOn = (raw: string | undefined = process.env.NEXT_PUBLIC_INSTAGRAM_HUMAN_AGENT) => /^(1|true|on|yes)$/i.test((raw ?? "").trim());
