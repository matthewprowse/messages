import { test } from "node:test";
import assert from "node:assert/strict";
import { HelperError } from "./helper";
import {
  APP_EXPIRED, LIMITED_FIRST_MS, LIMITED_MAX_MS, NOT_BUILT, NO_COOKIES, PushBack, REFUSED, RESTRICTED, SIGNED_OUT, SIGN_IN_BLOCKED, SIGN_IN_CHALLENGE, SIGN_IN_FAILED,
  SIGN_IN_RATE_LIMITED, SIGN_IN_REJECTED, SIGN_IN_UNAVAILABLE, START_AMBIGUOUS, START_MAYBE_SENT, START_NOT_FOUND, START_NO_PERSON, START_REFUSED, START_TURNED_AWAY,
  FILES_NOT_TAKEN, SEND_MAYBE_SENT, SEND_PARTIAL, SEND_TURNED_AWAY, START_PARTIAL,
  checkpointDetail, endsSession, outcomeOf, recipientOf, sendFailure, signInFailure, startFailure, surelyNotSent,
} from "./policy";

const noJitter = () => 0;

test("an expired session or a 403 stops the account with a reason", () => {
  assert.deepEqual(outcomeOf(new HelperError("bad_credentials"), new PushBack()), { stop: true, detail: SIGNED_OUT });
  assert.deepEqual(outcomeOf(new HelperError("forbidden", 403), new PushBack()), { stop: true, detail: RESTRICTED });
});

test("429s back off for half an hour, doubling up to six hours", () => {
  const pushback = new PushBack();
  const waits = [1, 2, 3, 4, 5, 6, 7, 8].map(() => {
    const o = outcomeOf(new HelperError("rate_limited", 429), pushback, noJitter);
    assert.equal(o.stop, false);
    return o.stop ? 0 : o.waitMs;
  });
  assert.equal(waits[0], LIMITED_FIRST_MS);
  assert.equal(waits[1], LIMITED_FIRST_MS * 2);
  assert.equal(waits[7], LIMITED_MAX_MS);
  const o = outcomeOf(new HelperError("rate_limited"), new PushBack(), noJitter);
  assert.ok(!o.stop && o.detail.includes("about 30 minutes"));
});

test("three 999s in a row stop the account; a 429 between them starts the count again", () => {
  const pushback = new PushBack();
  assert.equal(outcomeOf(new HelperError("refused", 999), pushback, noJitter).stop, false);
  assert.equal(outcomeOf(new HelperError("refused", 999), pushback, noJitter).stop, false);
  assert.equal(outcomeOf(new HelperError("rate_limited", 429), pushback, noJitter).stop, false);
  assert.equal(outcomeOf(new HelperError("refused", 999), pushback, noJitter).stop, false);
  assert.equal(outcomeOf(new HelperError("refused", 999), pushback, noJitter).stop, false);
  assert.deepEqual(outcomeOf(new HelperError("refused", 999), pushback, noJitter), { stop: true, detail: REFUSED });
});

test("a connection that worked resets the back-off", () => {
  const pushback = new PushBack();
  outcomeOf(new HelperError("rate_limited"), pushback, noJitter);
  outcomeOf(new HelperError("rate_limited"), pushback, noJitter);
  pushback.ok();
  const o = outcomeOf(new HelperError("rate_limited"), pushback, noJitter);
  assert.ok(!o.stop && o.waitMs === LIMITED_FIRST_MS);
});

test("anything else reconnects with the usual backoff", () => {
  for (const err of [new HelperError("failed"), new HelperError("exited"), new HelperError("timeout"), new Error("boom")]) {
    const o = outcomeOf(err, new PushBack());
    assert.ok(!o.stop && o.waitMs === null);
  }
});

test("a send turned away by LinkedIn surely did not go; a timeout might have", () => {
  assert.equal(surelyNotSent(new HelperError("rate_limited", 429)), true);
  assert.equal(surelyNotSent(new HelperError("bad_credentials")), true);
  assert.equal(surelyNotSent(new HelperError("timeout")), false);
  assert.equal(surelyNotSent(new HelperError("failed", 500)), false);
  assert.equal(surelyNotSent(new Error("x")), false);
});

test("what people are told never names a command or a file", () => {
  const said = [
    SIGNED_OUT, RESTRICTED, REFUSED, NOT_BUILT, NO_COOKIES, SIGN_IN_REJECTED, SIGN_IN_BLOCKED, SIGN_IN_CHALLENGE, SIGN_IN_RATE_LIMITED, SIGN_IN_UNAVAILABLE,
    SIGN_IN_FAILED, APP_EXPIRED, checkpointDetail({ kind: "app", method: null }), checkpointDetail({ kind: "code", method: "sms" }, true),
  ];
  for (const text of said) assert.doesNotMatch(text, /pnpm|\bgo\b|\.env|terminal|build|cookie|[\u2013\u2014]/i, text);
});

test("a sign-in that ends says what a person can do about it", () => {
  assert.equal(signInFailure(new HelperError("rejected", 200, "authenticate")), SIGN_IN_REJECTED);
  assert.equal(signInFailure(new HelperError("rejected", 200, "app_approval_expired")), APP_EXPIRED);
  assert.equal(signInFailure(new HelperError("blocked", 403)), SIGN_IN_BLOCKED);
  assert.equal(signInFailure(new HelperError("challenge")), SIGN_IN_CHALLENGE);
  assert.equal(signInFailure(new HelperError("rate_limited", 429)), SIGN_IN_RATE_LIMITED);
  assert.equal(signInFailure(new HelperError("unavailable", 503)), SIGN_IN_UNAVAILABLE);
  assert.equal(signInFailure(new HelperError("timeout")), SIGN_IN_UNAVAILABLE);
  assert.equal(signInFailure(new HelperError("unsupported")), SIGN_IN_FAILED);
  assert.equal(signInFailure(new Error("boom")), SIGN_IN_FAILED);
  assert.match(SIGN_IN_CHALLENGE, /LinkedIn app/);
});

test("each check has its own words", () => {
  assert.equal(checkpointDetail({ kind: "code", method: "email" }), "Enter the 6-digit code LinkedIn emailed you.");
  assert.equal(checkpointDetail({ kind: "code", method: "sms" }), "Enter the 6-digit code LinkedIn texted you.");
  assert.equal(checkpointDetail({ kind: "code", method: "totp" }), "Enter the 6-digit code your authenticator app shows.");
  assert.equal(checkpointDetail({ kind: "code", method: "email" }, true), "That code did not work. Enter the 6-digit code LinkedIn emailed you.");
  assert.equal(checkpointDetail({ kind: "app", method: null }), "Approve the sign-in in the LinkedIn app on your phone.");
});

test("a new conversation is to exactly one person", () => {
  assert.equal(recipientOf(["urn:li:fsd_profile:ACoAAOTHER"]), "urn:li:fsd_profile:ACoAAOTHER");
  assert.equal(recipientOf([" https://www.linkedin.com/in/sam-example "]), "https://www.linkedin.com/in/sam-example");
  assert.equal(recipientOf([]), null);
  assert.equal(recipientOf(["a", "b"]), null);
  assert.equal(recipientOf(["  "]), null);
});

test("a failed start says what a person can do, and only a lost answer says it may have gone", () => {
  assert.equal(startFailure(new HelperError("not_found")), START_NOT_FOUND);
  assert.equal(startFailure(new HelperError("ambiguous")), START_AMBIGUOUS);
  assert.equal(startFailure(new HelperError("forbidden", 403)), START_REFUSED);
  assert.equal(startFailure(new HelperError("bad_request", 422)), START_REFUSED);
  assert.equal(startFailure(new HelperError("bad_request")), START_NO_PERSON);
  assert.equal(startFailure(new HelperError("rate_limited", 429)), START_TURNED_AWAY);
  assert.equal(startFailure(new HelperError("timeout")), START_MAYBE_SENT);
  assert.equal(startFailure(new HelperError("failed", 500)), START_MAYBE_SENT);
  assert.equal(startFailure(new Error("x")), START_MAYBE_SENT);
  for (const said of [START_NO_PERSON, START_NOT_FOUND, START_AMBIGUOUS, START_REFUSED, START_TURNED_AWAY, START_MAYBE_SENT]) assert.doesNotMatch(said, /[\u2013\u2014]/);
});

test("a person who cannot be found does not end the session; being signed out does", () => {
  assert.equal(endsSession(new HelperError("not_found")), false);
  assert.equal(endsSession(new HelperError("ambiguous")), false);
  assert.equal(endsSession(new HelperError("bad_request", 422)), false);
  assert.equal(endsSession(new HelperError("bad_credentials")), true);
  assert.equal(endsSession(new HelperError("rate_limited", 429)), true);
  assert.equal(endsSession(new HelperError("timeout")), false);
});

test("a send of several files that stopped part way says some went out", () => {
  const partial = new HelperError("partial", undefined, undefined, 1);
  assert.equal(partial.sent, 1);
  assert.equal(surelyNotSent(partial), false);
  assert.equal(endsSession(partial), false);
  assert.equal(sendFailure(partial), SEND_PARTIAL);
  assert.equal(startFailure(partial, true), START_PARTIAL);
});

test("a failed reply says whether it certainly did not go", () => {
  assert.equal(sendFailure(new HelperError("forbidden", 403)), SEND_TURNED_AWAY);
  assert.equal(sendFailure(new HelperError("timeout")), SEND_MAYBE_SENT);
  assert.equal(sendFailure(new HelperError("failed")), SEND_MAYBE_SENT);
});

test("a start the helper turned away blames the files when it had any", () => {
  assert.equal(startFailure(new HelperError("bad_request")), START_NO_PERSON);
  assert.equal(startFailure(new HelperError("bad_request"), true), FILES_NOT_TAKEN);
  assert.equal(startFailure(new HelperError("bad_request", 400), true), START_REFUSED);
});
