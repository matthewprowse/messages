// calls.ts and the call and poll lines of normalize.ts: a call that rang out becomes a missed call line, and nothing else does.

import assert from "node:assert/strict";
import { test } from "node:test";
import { missedCallMessage } from "./calls";
import { describe } from "./normalize";

const ev = { chatId: "27821234567@s.whatsapp.net", from: "27821234567@s.whatsapp.net", id: "ABC", date: new Date("2026-11-02T10:00:00Z"), isVideo: false, isGroup: false, status: "timeout" as const };

test("a call that timed out becomes a missed voice call line", () => {
  const m = missedCallMessage(ev, false)!;
  assert.equal(m.key.id, "call-ABC");
  assert.equal(m.key.fromMe, false);
  assert.equal(m.messageTimestamp, 1_793_613_600);
  const d = describe(m.message);
  assert.equal(d.kind, "message");
  if (d.kind === "message") {
    assert.equal(d.text, "Missed Voice Call");
    assert.deepEqual(d.call, { video: false, missed: true });
  }
});

test("a missed video call says so", () => {
  const d = describe(missedCallMessage({ ...ev, isVideo: true }, false)!.message);
  assert.equal(d.kind === "message" && d.text, "Missed Video Call");
});

test("a group call names who rang in the key", () => {
  const m = missedCallMessage({ ...ev, chatId: "1203@g.us", isGroup: true, from: "27820000000@s.whatsapp.net" }, false)!;
  assert.equal(m.key.participant, "27820000000@s.whatsapp.net");
});

test("only a ring out counts: not a call you made, an answered one or a step on the way", () => {
  assert.equal(missedCallMessage(ev, true), null);
  for (const status of ["offer", "ringing", "accept", "reject", "terminate"] as const) assert.equal(missedCallMessage({ ...ev, status }, false), null);
});

test("an answered call in the log is a plain call line, not a missed one", () => {
  const d = describe({ callLogMesssage: { isVideo: false, callOutcome: 0 } });
  assert.equal(d.kind === "message" && d.text, "Voice Call");
  assert.equal(d.kind === "message" && d.call?.missed, false);
});

test("a poll keeps its options as text and says whether several may be picked", () => {
  const d = describe({
    messageContextInfo: { messageSecret: new Uint8Array([1, 2, 3]) },
    pollCreationMessageV3: { name: "Lunch?", options: [{ optionName: "Pizza" }, { optionName: "Sushi" }], selectableOptionsCount: 1 },
  });
  assert.equal(d.kind, "message");
  if (d.kind === "message") {
    assert.equal(d.text, "Poll: Lunch?\n• Pizza\n• Sushi");
    assert.equal(d.poll?.multi, false);
    assert.deepEqual([...(d.poll?.secret ?? [])], [1, 2, 3]);
  }
});

test("a vote is not stored as a message of its own", () => {
  assert.equal(describe({ pollUpdateMessage: { pollCreationMessageKey: { id: "P" } } }).kind, "skip");
});
