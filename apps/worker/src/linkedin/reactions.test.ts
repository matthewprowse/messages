// Tests for linkedin/reactions.ts: which emoji LinkedIn is sent, what is refused before sending, and that an action is
// always settled (done, or failed with a reason the app can show).

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tables } from "@messages/db";
import { HelperError } from "./helper";
import { REACTION_BAD_EMOJI, REACTION_FAILED, REACTION_GONE, REACTION_SLOW_DOWN, applyReaction, isSingleEmoji, planReaction, reactionFailure, type ReactArgs, type ReactIo } from "./reactions";

const CONV = "urn:li:msg_conversation:(urn:li:fsd_profile:ME,2-abc)";
const MSG = "urn:li:msg_message:(urn:li:fsd_profile:ME,2-abc-msg)";

test("one emoji passes, whatever it is made of", () => {
  for (const e of ["👍", "❤️", "👍🏽", "🇿🇦", "👨‍👩‍👧"]) assert.equal(isSingleEmoji(e), true, e);
});

test("text, several emoji and nothing are not one emoji", () => {
  for (const e of ["", "a", "ok", "👍👍", "👍 ", "1"]) assert.equal(isSingleEmoji(e), false, JSON.stringify(e));
});

test("an emoji becomes a react command and an empty one removes the reaction", () => {
  assert.deepEqual(planReaction("👍", CONV, MSG), { ok: true, args: { conversation: CONV, message: MSG, emoji: "👍", remove: false } });
  assert.deepEqual(planReaction(" ❤️ ", CONV, MSG), { ok: true, args: { conversation: CONV, message: MSG, emoji: "❤️", remove: false } });
  assert.deepEqual(planReaction("", CONV, MSG), { ok: true, args: { conversation: CONV, message: MSG, emoji: "", remove: true } });
  assert.deepEqual(planReaction(null, CONV, MSG), { ok: true, args: { conversation: CONV, message: MSG, emoji: "", remove: true } });
});

test("a bad emoji, or an id that is not a LinkedIn URN, is refused before anything is sent", () => {
  assert.deepEqual(planReaction("hello", CONV, MSG), { ok: false, error: REACTION_BAD_EMOJI });
  assert.deepEqual(planReaction("👍", "12345@s.whatsapp.net", MSG), { ok: false, error: REACTION_GONE });
  assert.deepEqual(planReaction("👍", CONV, "wamid.ABC"), { ok: false, error: REACTION_GONE });
  assert.deepEqual(planReaction("👍", null, MSG), { ok: false, error: REACTION_GONE });
});

test("pushback says to try later and anything else is the plain failure", () => {
  assert.equal(reactionFailure(new HelperError("rate_limited", 429)), REACTION_SLOW_DOWN);
  assert.equal(reactionFailure(new HelperError("refused", 999)), REACTION_SLOW_DOWN);
  assert.equal(reactionFailure(new HelperError("bad_request")), REACTION_FAILED);
  assert.equal(reactionFailure(new Error("x")), REACTION_FAILED);
});

const row = (over: Partial<Tables<"mail_actions">> = {}) => ({ id: "act1", user_id: "u1", thread_id: "t1", message_id: "m1", action: "react", emoji: "👍", ...over }) as Tables<"mail_actions">;

function harness(opts: { target?: Awaited<ReturnType<ReactIo["target"]>>; callError?: Error } = {}) {
  const log = { calls: [] as ReactArgs[], recorded: [] as [string, string][], finished: [] as [string, string | undefined][] };
  const io: ReactIo = {
    target: async () => ("target" in opts ? opts.target ?? null : { conversation: CONV, message: MSG, threadId: "t1" }),
    record: async (_a, message, emoji) => void log.recorded.push([message, emoji]),
    finish: async (id, error) => void log.finished.push([id, error]),
  };
  const helper = { call: async (_cmd: "react", args: ReactArgs) => { log.calls.push(args); if (opts.callError) throw opts.callError; return {}; } };
  return { log, io, helper };
}

test("a reaction goes to LinkedIn, is kept on the message, and the action is done", async () => {
  const h = harness();
  assert.equal(await applyReaction("a1", h.helper, row(), h.io), undefined);
  assert.deepEqual(h.log.calls, [{ conversation: CONV, message: MSG, emoji: "👍", remove: false }]);
  assert.deepEqual(h.log.recorded, [[MSG, "👍"]]);
  assert.deepEqual(h.log.finished, [["act1", undefined]]);
});

test("removing a reaction sends the removal and clears it on the message", async () => {
  const h = harness();
  await applyReaction("a1", h.helper, row({ emoji: "" }), h.io);
  assert.deepEqual(h.log.calls, [{ conversation: CONV, message: MSG, emoji: "", remove: true }]);
  assert.deepEqual(h.log.recorded, [[MSG, ""]]);
});

test("a message in another thread or a missing one fails the action without calling LinkedIn", async () => {
  for (const opts of [{ target: null }, { target: { conversation: CONV, message: MSG, threadId: "other" } }]) {
    const h = harness(opts);
    await applyReaction("a1", h.helper, row(), h.io);
    assert.deepEqual(h.log.calls, []);
    assert.deepEqual(h.log.finished, [["act1", REACTION_GONE]]);
  }
});

test("a helper failure fails the action, keeps nothing, and hands the error back for the back-off", async () => {
  const err = new HelperError("rate_limited", 429);
  const h = harness({ callError: err });
  assert.equal(await applyReaction("a1", h.helper, row(), h.io), err);
  assert.deepEqual(h.log.recorded, []);
  assert.deepEqual(h.log.finished, [["act1", REACTION_SLOW_DOWN]]);
});
