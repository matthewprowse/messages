// polls.ts: a poll's options come back out of its stored text, a vote's hashes map to option positions, and tallies count people.

import assert from "node:assert/strict";
import { test } from "node:test";
import { optionHash, parsePollText, selectedPositions, tally } from "./polls";
import { pollText } from "./normalize";

test("a poll's text reads back into its question and options", () => {
  const text = pollText("Lunch?", ["Pizza", "Sushi", "Salad"]);
  assert.deepEqual(parsePollText(text), { name: "Lunch?", options: ["Pizza", "Sushi", "Salad"] });
  assert.equal(parsePollText("Just a message"), null);
});

test("a vote's hashes become option positions in poll order", () => {
  const options = ["Pizza", "Sushi", "Salad"];
  const picked = [Buffer.from(optionHash("Salad"), "hex"), Buffer.from(optionHash("Pizza"), "hex")];
  assert.deepEqual(selectedPositions(options, picked), [0, 2]);
});

test("a hash that matches nothing is ignored, and a clear vote is empty", () => {
  assert.deepEqual(selectedPositions(["A", "B"], [Buffer.from("00", "hex")]), []);
  assert.deepEqual(selectedPositions(["A", "B"], []), []);
});

test("the tally counts each person once per option and ignores positions that do not exist", () => {
  assert.deepEqual(tally(3, { a: [0, 2], b: [2], c: [], d: [2, 2, 9] }), [1, 0, 3]);
});
