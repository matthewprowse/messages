// Sending a reaction to LinkedIn, the way WhatsApp's actions.ts does: a 'react' mail_action names a message and an
// emoji (empty removes yours), the helper's `react` command puts it on LinkedIn, and only then is it kept on the
// message for the app to show. Everything here is pure (the database comes in as `io`, see react-action.ts) so it
// is tested. LinkedIn reactions are emoji, so the emoji goes through as typed once it is checked to be exactly one.

import type { Tables } from "@messages/db";
import { errorCode, log } from "../log";
import { HelperError, type Commands } from "./helper";

/** Who you are in provider_meta.reactions; the same key as WhatsApp's SELF (whatsapp/reactions.ts, not imported: it pulls in Baileys). */
export const SELF = "me";

export const REACTION_FAILED = "Could not send your reaction to LinkedIn.";
export const REACTION_BAD_EMOJI = "LinkedIn only takes one emoji as a reaction.";
export const REACTION_GONE = "That message is no longer there to react to.";
export const REACTION_SLOW_DOWN = "LinkedIn asked Konva to slow down. Try your reaction again later.";

export type ReactArgs = Commands["react"]["args"];
export type ReactionPlan = { ok: true; args: ReactArgs } | { ok: false; error: string };

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** True for exactly one emoji: one grapheme (a flag, a skin tone or a family counts as one) that is pictographic. */
export function isSingleEmoji(text: string): boolean {
  const parts = [...segmenter.segment(text)];
  return parts.length === 1 && text.length <= 32 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text);
}

/**
 * The helper command for one reaction action, or why it cannot go. Both ends must be LinkedIn's own URNs, so a
 * message that was never stored with one (or a thread of another channel) is refused here rather than sent.
 */
export function planReaction(emoji: string | null | undefined, conversation: string | null | undefined, message: string | null | undefined): ReactionPlan {
  if (!conversation?.startsWith("urn:li:") || !message?.startsWith("urn:li:")) return { ok: false, error: REACTION_GONE };
  const text = (emoji ?? "").trim();
  if (text === "") return { ok: true, args: { conversation, message, emoji: "", remove: true } };
  if (!isSingleEmoji(text)) return { ok: false, error: REACTION_BAD_EMOJI };
  return { ok: true, args: { conversation, message, emoji: text, remove: false } };
}

/** What a failed reaction says on the action. A turned-away request says to try later; the rest is the plain failure. */
export function reactionFailure(err: unknown): string {
  return err instanceof HelperError && (err.kind === "rate_limited" || err.kind === "refused") ? REACTION_SLOW_DOWN : REACTION_FAILED;
}

/** The part of the connector's helper this needs, so tests hand in their own. */
export interface ReactHelper {
  call(cmd: "react", args: ReactArgs): Promise<unknown>;
}

/** The database side (react-action.ts has the real one), so tests hand in their own. */
export interface ReactIo {
  target(row: Tables<"mail_actions">, accountId: string): Promise<{ conversation: string | null; message: string | null; threadId: string } | null>;
  record(accountId: string, message: string, emoji: string): Promise<void>;
  finish(actionId: string, error?: string): Promise<void>;
}

/**
 * Sends one 'react' action and settles it either way. Returns the error when the session should hear of it (LinkedIn
 * pushed back), for the connector's back-off; the action itself is always finished.
 */
export async function applyReaction(accountId: string, helper: ReactHelper, row: Tables<"mail_actions">, io: ReactIo): Promise<unknown> {
  try {
    const target = await io.target(row, accountId);
    if (!target || target.threadId !== row.thread_id) return void (await io.finish(row.id, REACTION_GONE));
    const plan = planReaction(row.emoji, target.conversation, target.message);
    if (!plan.ok) return void (await io.finish(row.id, plan.error));
    await helper.call("react", plan.args);
    await io.record(accountId, plan.args.message, plan.args.emoji);
    log.info("linkedin reaction sent", { account: accountId, action: row.id });
    await io.finish(row.id);
    return undefined;
  } catch (err) {
    log.warn("linkedin reaction failed", { account: accountId, action: row.id, code: errorCode(err) });
    await io.finish(row.id, reactionFailure(err));
    return err;
  }
}
