// Reads a vote on a poll and keeps it on the poll message. The poll was stored with its vote key sealed in provider_meta.poll.secret
// and its options in the message text; the vote is opened with that key, matched to option positions (polls.ts) and saved
// through public.whatsapp_poll_vote. A vote for a poll that was never stored here (it came before the link) is quietly dropped.

import { decryptPollVote, getKeyAuthor, jidNormalizedUser, normalizeMessageContent, type WAMessage, type WAMessageKey } from "baileys";
import { FIELD } from "@messages/crypto/fields";
import { db, must } from "../db";
import { open } from "../vault";
import type { AccountCtx } from "./person";
import { parsePollText, selectedPositions } from "./polls";

/** The poll a message is a vote on, or null when it is any other message. */
export function voteOf(msg: WAMessage) {
  const update = normalizeMessageContent(msg.message)?.pollUpdateMessage;
  return update?.pollCreationMessageKey?.id && update.vote ? { update, creation: update.pollCreationMessageKey as WAMessageKey & { id: string } } : null;
}

/**
 * Saves the vote in `msg` on its poll. `who` turns the voter's message key into the stable, content-free name stored in
 * poll_votes (the same hash reactions use). Returns whether a vote was saved.
 */
export async function applyPollVote(ctx: AccountCtx, meId: string, msg: WAMessage, who: (key: WAMessageKey) => Promise<string>): Promise<boolean> {
  const found = voteOf(msg);
  if (!found) return false;
  const row = must(
    await db.from("messages").select("body_text, provider_meta").eq("account_id", ctx.accountId).eq("provider_message_id", found.creation.id).maybeSingle(),
    "load poll",
  );
  const sealedKey = (row?.provider_meta as { poll?: { secret?: string } } | null)?.poll?.secret;
  const [text, secret] = await Promise.all([open(ctx.userId, FIELD.body, row?.body_text), open(ctx.userId, FIELD.quote, sealedKey)]);
  const poll = text ? parsePollText(text) : null;
  if (!poll || !secret) return false;
  const me = jidNormalizedUser(meId);
  const vote = decryptPollVote(found.update.vote!, {
    pollEncKey: Buffer.from(secret, "base64"),
    pollCreatorJid: getKeyAuthor(found.creation, me),
    pollMsgId: found.creation.id,
    voterJid: getKeyAuthor(msg.key, me),
  });
  const picked = selectedPositions(poll.options, vote.selectedOptions ?? []);
  must(
    await db.rpc("whatsapp_poll_vote", { p_account_id: ctx.accountId, p_provider_message_id: found.creation.id, p_voter: await who(msg.key), p_selected: picked }),
    "save poll vote",
  );
  return true;
}
