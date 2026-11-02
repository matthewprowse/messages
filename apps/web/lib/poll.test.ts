// poll.ts: a stored poll text reads back into options, and votes are counted once per person per option.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePoll, pollView } from "./poll";

const body = "Poll: Lunch?\n• Pizza\n• Sushi\n• Salad";

test("a poll's text gives its question and options, and other text is not a poll", () => {
  assert.deepEqual(parsePoll(body), { name: "Lunch?", options: ["Pizza", "Sushi", "Salad"] });
  assert.equal(parsePoll("See you at 5"), null);
});

test("votes are counted per option and per person", () => {
  const v = pollView(body, { a: [0, 2], b: [2], c: [], d: [2, 2, 7] })!;
  assert.deepEqual(v.options.map((o) => o.votes), [1, 0, 3]);
  assert.equal(v.voters, 3);
});

test("a poll nobody has voted on shows zero for each option", () => {
  assert.deepEqual(pollView(body)!.options.map((o) => o.votes), [0, 0, 0]);
});
