// calls.ts and the call and poll lines of normalize.ts: a call that rang out becomes a missed call line, a finished call from the
// call log becomes a line with its direction, outcome and length, and nothing else does.

import assert from "node:assert/strict";
import { test } from "node:test";
import { proto } from "baileys";
import { callLogMessage, callLogRecordOf, missedCallMessage } from "./calls";
import { linkLogger } from "./logger";
import { callLength, describe } from "./normalize";

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

const ME = "27820000001@s.whatsapp.net";
const THEM = "27821234567@s.whatsapp.net";
const mine = new Set([ME, "1111@lid"]);
const R = proto.CallLogRecord.CallResult;
const record = (over: Partial<proto.ICallLogRecord> = {}): proto.ICallLogRecord => ({
  callId: "XYZ", startTime: 1_793_613_600, duration: 192, isIncoming: false, isVideo: false, callResult: R.CONNECTED,
  callCreatorJid: ME, participants: [{ userJid: THEM, callResult: R.CONNECTED }], ...over,
});
const line = (m: ReturnType<typeof callLogMessage>) => {
  const d = describe(m!.message);
  assert.equal(d.kind, "message");
  return d.kind === "message" ? d : null!;
};

test("a call you made from your phone is your line in their chat, with how long it lasted", () => {
  const m = callLogMessage(record(), mine)!;
  assert.deepEqual(m.key, { remoteJid: THEM, fromMe: true, id: "call-XYZ" });
  assert.equal(m.messageTimestamp, 1_793_613_600);
  const d = line(m);
  assert.equal(d.text, "Voice Call, 3 Min");
  assert.deepEqual(d.call, { video: false, missed: false, seconds: 192 });
});

test("a call to you that you answered is theirs, and a start in milliseconds is read as such", () => {
  const m = callLogMessage(record({ isIncoming: true, callCreatorJid: THEM, participants: [{ userJid: ME }], startTime: 1_793_613_600_000, isVideo: true, duration: 45 }), mine)!;
  assert.equal(m.key.remoteJid, THEM);
  assert.equal(m.key.fromMe, false);
  assert.equal(m.messageTimestamp, 1_793_613_600);
  assert.equal(line(m).text, "Video Call, 45 Sec");
});

test("a call to you that was missed, cancelled or declined says so, with no length", () => {
  for (const result of [R.MISSED, R.CANCELLED]) {
    const d = line(callLogMessage(record({ isIncoming: true, callCreatorJid: THEM, callResult: result, duration: 0 }), mine));
    assert.equal(d.text, "Missed Voice Call");
  }
  const d = line(callLogMessage(record({ isIncoming: true, callCreatorJid: THEM, callResult: R.REJECTED }), mine));
  assert.equal(d.text, "Declined Voice Call");
  assert.deepEqual(d.call, { video: false, missed: false, declined: true });
});

test("a call you made that nobody answered is stored as missed, from you", () => {
  const m = callLogMessage(record({ callResult: R.UNAVAILABLE, duration: 0 }), mine)!;
  assert.equal(m.key.fromMe, true);
  assert.equal(line(m).call?.missed, true);
});

test("a call answered on another device counts as answered", () => {
  assert.equal(line(callLogMessage(record({ isIncoming: true, callCreatorJid: THEM, callResult: R.ACCEPTEDELSEWHERE }), mine)).call?.missed, false);
});

test("a group call sits in its group, naming who rang", () => {
  const m = callLogMessage(record({ isIncoming: true, callCreatorJid: THEM, groupJid: "1203@g.us" }), mine)!;
  assert.equal(m.key.remoteJid, "1203@g.us");
  assert.equal(m.key.participant, THEM);
});

test("calls with no one chat, links, unfinished calls and records with no id or start are not stored", () => {
  assert.equal(callLogMessage(record({ participants: [{ userJid: THEM }, { userJid: "27829999999@s.whatsapp.net" }] }), mine), null);
  assert.equal(callLogMessage(record({ isCallLink: true }), mine), null);
  for (const callResult of [R.ONGOING, R.UPCOMING, R.INVALID]) assert.equal(callLogMessage(record({ callResult }), mine), null);
  assert.equal(callLogMessage(record({ callId: "" }), mine), null);
  assert.equal(callLogMessage(record({ startTime: 0 }), mine), null);
});

test("the link logger passes on call log records from app state sync and nothing else", () => {
  const got: proto.ICallLogRecord[] = [];
  const logger = linkLogger((r) => got.push(r));
  const traced = { syncAction: { syncAction: { value: { callLogAction: { callLogRecord: record() } } }, index: ["callLog"] }, initialSync: false };
  logger.trace(traced, "processing sync action");
  logger.child({}).trace(traced, "processing sync action");
  logger.trace(traced, "something else");
  logger.trace({ syncAction: { syncAction: { value: { muteAction: { muted: true } } } } }, "processing sync action");
  assert.equal(got.length, 2);
  assert.equal(got[0]?.callId, "XYZ");
  assert.equal(callLogRecordOf(null), null);
});

test("call lengths read the way WhatsApp says them", () => {
  assert.equal(callLength(0.4), "1 Sec");
  assert.equal(callLength(59), "59 Sec");
  assert.equal(callLength(90), "2 Min");
  assert.equal(callLength(3900), "1 Hr 5 Min");
  assert.equal(callLength(3600), "1 Hr");
});
