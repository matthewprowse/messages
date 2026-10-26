import { test } from "node:test";
import assert from "node:assert/strict";
import { HelperError } from "./helper";
import { LIMITED_FIRST_MS, LIMITED_MAX_MS, PushBack, REFUSED, RESTRICTED, SIGNED_OUT, outcomeOf, surelyNotSent } from "./policy";

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
