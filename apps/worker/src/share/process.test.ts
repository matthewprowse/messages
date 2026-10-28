import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptField, decryptTeamField, deriveTeamKeys, deriveUserKeys, encryptField, isTeamCiphertext, newDataKey, type TeamKeys, type UserKeys } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { MAX_PASSES, PAGE_ROWS, runShareJob, type ShareJob, type ShareStore, type ShareTable } from "./process";
import { moveMessage, moveValue, shareLabel, latestIsShared, type Keys, type LabelSource, type MessageAiRow, type MessageRow, type Move, type RowWrite, type ThreadRow } from "./reseal";

// The share job over a fake database and real keys. The fake keeps the rules of share_pending_* and share_write
// (20261101120000_shared_chats.sql, checked against a real Postgres when it was written): the rows still to move,
// the old values a write must still find, and the chat being in the state the job is for.

const WS = "ws-1";
const AGENT = "agent-1";
const T = "thread-1";

interface Fixture {
  user: UserKeys;
  team: TeamKeys;
  keys: Keys;
}
async function fixture(): Promise<Fixture> {
  const user = await deriveUserKeys(newDataKey());
  const team = await deriveTeamKeys(newDataKey());
  return { user, team, keys: { user: async () => user, team: async () => team } };
}

type Msg = MessageRow & { sent_at: string; thread_id: string };
type Ai = MessageAiRow & { sent_at: string };
type Att = { id: string; workspace_id: string | null; sent_at: string };

/** Whether a stored value is waiting to be sealed with the team key: anything but empty and t1. */
const needsSeal = (v: string | null) => !!v && !v.startsWith("t1:");
const needsSealAddress = (v: string | null) => !!v && v.startsWith("e1:");

class FakeStore implements ShareStore {
  thread_: ThreadRow;
  messages: Msg[] = [];
  ai: Ai[] = [];
  attachments: Att[] = [];
  members = new Map<string, string>([[`${WS}:${AGENT}`, "active"]]);
  writes: { table: string; rows: number }[] = [];
  /** Runs before each write, so a test can change a row between the job reading it and writing it. */
  beforeWrite: (table: string) => void = () => undefined;
  failWriteAfter = Infinity;
  label: LabelSource = { groupName: null, contactNames: ["Thandi Mokoena"], subject: null };

  constructor(thread: Partial<ThreadRow> = {}) {
    this.thread_ = {
      id: T, user_id: AGENT, workspace_id: WS, share_from: null, last_message_at: null, subject: null, last_message_preview: null, summary: null,
      share_label: null, is_group: false, group_name: null, ...thread,
    };
  }
  async thread(id: string) { return id === T ? { ...this.thread_ } : null; }
  async isActiveMember(workspaceId: string, userId: string) { return this.members.get(`${workspaceId}:${userId}`) === "active"; }

  private inRange(sentAt: string) {
    const t = this.thread_;
    return t.share_from == null || Date.parse(sentAt) >= Date.parse(t.share_from);
  }
  private wanted(direction: string, row: { workspace_id: string | null; sent_at: string }, moveNeeded: boolean, teamText: boolean) {
    const t = this.thread_;
    return direction === "to_work"
      ? t.workspace_id !== null && this.inRange(row.sent_at) && (row.workspace_id !== t.workspace_id || moveNeeded)
      : t.workspace_id === null && (row.workspace_id !== null || teamText);
  }
  pending(table: "messages", threadId: string, direction: string, after: string | null, limit: number): Promise<MessageRow[]>;
  pending(table: "message_ai", threadId: string, direction: string, after: string | null, limit: number): Promise<MessageAiRow[]>;
  pending(table: "attachments", threadId: string, direction: string, after: string | null, limit: number): Promise<{ id: string; workspace_id: string | null }[]>;
  async pending(table: "messages" | "message_ai" | "attachments", _thread: string, direction: string, after: string | null, limit: number): Promise<unknown[]> {
    const key = (r: { id?: string; message_id?: string }) => (r.message_id ?? r.id)!;
    let rows: { id?: string; message_id?: string }[];
    if (table === "messages") {
      rows = this.messages.filter((m) =>
        this.wanted(direction, m, [m.subject, m.preview, m.body_text, m.body_html, m.list_unsubscribe, m.body_marks, m.transcript].some(needsSeal)
          || needsSealAddress(m.sender_address) || m.to_addresses.some(needsSealAddress) || needsSeal((m.provider_meta as { quoted?: { text?: string } })?.quoted?.text ?? null),
        [m.subject, m.body_text, m.sender_address, ...m.to_addresses].some((v) => v?.startsWith("t1:"))));
    } else if (table === "message_ai") {
      rows = this.ai.filter((a) => this.wanted(direction, a, needsSeal(a.summary) || needsSeal(a.reply_choices), !!a.summary?.startsWith("t1:") || !!a.reply_choices?.startsWith("t1:")));
    } else {
      rows = this.attachments.filter((a) => this.wanted(direction, a, false, false));
    }
    return rows.filter((r) => after === null || key(r) > after).sort((a, b) => key(a).localeCompare(key(b))).slice(0, limit).map((r) => structuredClone(r));
  }

  async write(table: ShareTable | "threads", _thread: string, workspaceId: string | null, rows: RowWrite[]) {
    this.beforeWrite(table);
    if (this.writes.length >= this.failWriteAfter) throw Object.assign(new Error("connection lost"), { code: "ECONNRESET" });
    this.writes.push({ table, rows: rows.length });
    // Nothing is written once the chat is no longer in the state this write is for.
    if (this.thread_.workspace_id !== workspaceId) return 0;
    let written = 0;
    for (const w of rows) {
      const target: Record<string, unknown> | undefined =
        table === "threads" ? (this.thread_ as unknown as Record<string, unknown>)
        : table === "messages" ? (this.messages.find((m) => m.id === w.id) as unknown as Record<string, unknown> | undefined)
        : table === "message_ai" ? (this.ai.find((a) => a.message_id === w.id) as unknown as Record<string, unknown> | undefined)
        : (this.attachments.find((a) => a.id === w.id) as unknown as Record<string, unknown> | undefined);
      if (!target) continue;
      if (!Object.entries(w.expect).every(([k, v]) => JSON.stringify(target[k] ?? null) === JSON.stringify(v ?? null))) continue;
      for (const [k, v] of Object.entries(w.set)) {
        if (k === "workspace_id" && v !== null && v !== workspaceId) throw new Error("wrong workspace");
        target[k] = v;
      }
      written++;
    }
    return written;
  }
  async labelSource() { return this.label; }
}

const job = (direction: ShareJob["direction"]): ShareJob => ({ id: "job", thread_id: T, workspace_id: WS, direction });

/** A message sealed under the agent's key with something in every field. */
async function message(f: Fixture, n: number, sentAt: string, over: Partial<Msg> = {}): Promise<Msg> {
  const e = (field: string, text: string) => encryptField(f.user, field, text);
  return {
    id: `m-${String(n).padStart(4, "0")}`, thread_id: T, sent_at: sentAt, workspace_id: null,
    subject: await e(FIELD.subject, `subject ${n}`), preview: await e(FIELD.preview, `preview ${n}`), body_text: await e(FIELD.body, `body ${n}`),
    body_html: await e(FIELD.html, `<p>html ${n}</p>`), list_unsubscribe: await e(FIELD.unsubscribe, `<https://x.test/u/${n}>`),
    body_marks: await e(FIELD.marks, `[{"s":0,"e":4}]`), transcript: await e(FIELD.transcript, `said ${n}`),
    sender_address: await e(FIELD.address, `sender${n}@x.test`), to_addresses: [await e(FIELD.address, `a${n}@x.test`), await e(FIELD.address, `b${n}@x.test`)],
    provider_meta: { chat: await e(FIELD.address, "27820000000@s.whatsapp.net"), quoted: { id: "q", text: await e(FIELD.quote, `quote ${n}`) }, folder: "INBOX" },
    ...over,
  };
}
const aiRow = async (f: Fixture, m: Msg): Promise<Ai> => ({
  message_id: m.id, sent_at: m.sent_at, workspace_id: null,
  summary: await encryptField(f.user, FIELD.summary, `summary of ${m.id}`), reply_choices: await encryptField(f.user, FIELD.choices, `["Yes","No"]`),
});

const MESSAGE_COLUMNS = ["subject", "preview", "body_text", "body_html", "list_unsubscribe", "body_marks", "transcript", "sender_address"] as const;
const FIELD_OF = { subject: FIELD.subject, preview: FIELD.preview, body_text: FIELD.body, body_html: FIELD.html, list_unsubscribe: FIELD.unsubscribe, body_marks: FIELD.marks, transcript: FIELD.transcript, sender_address: FIELD.address } as const;

/** Every text field of a message, opened with the keys its prefix names. */
async function readable(f: Fixture, m: Msg): Promise<Record<string, string>> {
  const open = (field: string, v: string | null) => (v == null ? "" : isTeamCiphertext(v) ? decryptTeamField(f.team, field, v) : decryptField(f.user, field, v));
  const out: Record<string, string> = {};
  for (const c of MESSAGE_COLUMNS) out[c] = await open(FIELD_OF[c], m[c]);
  out.to = (await Promise.all(m.to_addresses.map((a) => open(FIELD.address, a)))).join(",");
  out.quote = await open(FIELD.quote, (m.provider_meta as { quoted: { text: string } }).quoted.text);
  return out;
}
const prefixes = (m: Msg) => [...MESSAGE_COLUMNS.map((c) => m[c]), ...m.to_addresses, (m.provider_meta as { quoted: { text: string } }).quoted.text].map((v) => v!.slice(0, 3));

async function seed(f: Fixture, store: FakeStore, count = 3) {
  for (let i = 1; i <= count; i++) {
    const m = await message(f, i, `2026-10-${String(i).padStart(2, "0")}T10:00:00Z`);
    store.messages.push(m);
    store.ai.push(await aiRow(f, m));
    store.attachments.push({ id: `att-${i}`, workspace_id: null, sent_at: m.sent_at });
  }
  store.thread_.subject = await encryptField(f.user, FIELD.subject, "Quote for the Mokoena estate");
  store.thread_.last_message_preview = await encryptField(f.user, FIELD.preview, "last preview");
  store.thread_.summary = await encryptField(f.user, FIELD.summary, "thread summary");
  store.thread_.last_message_at = store.messages[store.messages.length - 1].sent_at;
}

test("marking as work seals every field of every row with the team key, and moving back restores them all", async () => {
  const f = await fixture();
  const store = new FakeStore();
  await seed(f, store);
  const before = await Promise.all(store.messages.map((m) => readable(f, m)));

  const shared = await runShareJob(job("to_work"), store, f.keys);
  assert.equal(shared.state, "done");
  for (const [i, m] of store.messages.entries()) {
    assert.deepEqual([...new Set(prefixes(m))], ["t1:"], "every sealed field is t1");
    assert.equal(m.workspace_id, WS);
    assert.deepEqual(await readable(f, m), before[i], "and reads the same");
    assert.equal((m.provider_meta as { chat: string }).chat.slice(0, 3), "e1:", "the chat id stays under the agent's key, the worker needs it to send");
    assert.equal((m.provider_meta as { folder: string }).folder, "INBOX");
  }
  for (const a of store.ai) {
    assert.ok(a.summary.startsWith("t1:") && a.reply_choices!.startsWith("t1:"));
    assert.equal(a.workspace_id, WS);
    assert.equal(await decryptTeamField(f.team, FIELD.summary, a.summary), `summary of ${a.message_id}`);
    assert.equal(await decryptTeamField(f.team, FIELD.choices, a.reply_choices!), `["Yes","No"]`);
  }
  assert.ok(store.attachments.every((a) => a.workspace_id === WS));
  const t = store.thread_;
  assert.equal(await decryptTeamField(f.team, FIELD.subject, t.subject!), "Quote for the Mokoena estate");
  assert.equal(await decryptTeamField(f.team, FIELD.preview, t.last_message_preview!), "last preview");
  assert.equal(await decryptTeamField(f.team, FIELD.summary, t.summary!), "thread summary");
  assert.equal(await decryptTeamField(f.team, FIELD.name, t.share_label!), "Thandi Mokoena");

  // The agent moves it back: the chat is personal at once (the database does that), then the job re-seals.
  store.thread_.workspace_id = null;
  const back = await runShareJob(job("to_personal"), store, f.keys);
  assert.equal(back.state, "done");
  for (const [i, m] of store.messages.entries()) {
    assert.deepEqual([...new Set(prefixes(m))], ["e1:"]);
    assert.equal(m.workspace_id, null);
    assert.deepEqual(await readable(f, m), before[i]);
  }
  for (const a of store.ai) {
    assert.ok(a.summary.startsWith("e1:") && a.reply_choices!.startsWith("e1:") && a.workspace_id === null);
    assert.equal(await decryptField(f.user, FIELD.summary, a.summary), `summary of ${a.message_id}`);
  }
  assert.ok(store.attachments.every((a) => a.workspace_id === null));
  assert.equal(await decryptField(f.user, FIELD.subject, t.subject!), "Quote for the Mokoena estate");
  assert.equal(await decryptField(f.user, FIELD.summary, t.summary!), "thread summary");
  assert.equal(t.share_label, null);
});

test("share_from is respected: older messages stay under the agent's key with no workspace", async () => {
  const f = await fixture();
  const store = new FakeStore({ share_from: "2026-10-02T00:00:00Z" });
  await seed(f, store);
  const old = structuredClone(store.messages[0]);
  const oldAi = structuredClone(store.ai[0]);

  await runShareJob(job("to_work"), store, f.keys);
  assert.deepEqual(store.messages[0], old, "the message before share_from is untouched");
  assert.deepEqual(store.ai[0], oldAi);
  assert.equal(store.attachments[0].workspace_id, null);
  assert.equal(store.messages[0].workspace_id, null);
  for (const m of store.messages.slice(1)) assert.deepEqual([...new Set(prefixes(m))], ["t1:"]);
  assert.deepEqual(store.attachments.map((a) => a.workspace_id), [null, WS, WS]);
});

test("a chat shared from today keeps an older preview and summary under the agent's key, and still seals its subject", async () => {
  const f = await fixture();
  const store = new FakeStore({ share_from: "2026-11-01T00:00:00Z" });
  await seed(f, store); // every message is older than share_from
  const preview = store.thread_.last_message_preview;
  await runShareJob(job("to_work"), store, f.keys);
  assert.ok(store.thread_.subject!.startsWith("t1:"));
  assert.equal(store.thread_.last_message_preview, preview);
  assert.ok(store.thread_.summary!.startsWith("e1:"));
  assert.ok(store.messages.every((m) => m.workspace_id === null));

  // A shared message arrives, and the chat's preview and summary now come from it: the follow-up seals them.
  store.thread_.last_message_at = "2026-11-02T10:00:00Z";
  store.thread_.last_message_preview = await encryptField(f.user, FIELD.preview, "new preview");
  store.thread_.summary = await encryptField(f.user, FIELD.summary, "new summary");
  const fresh = await message(f, 9, "2026-11-02T10:00:00Z");
  store.messages.push(fresh);
  await runShareJob(job("to_work"), store, f.keys);
  assert.equal(await decryptTeamField(f.team, FIELD.preview, store.thread_.last_message_preview!), "new preview");
  assert.equal(await decryptTeamField(f.team, FIELD.summary, store.thread_.summary!), "new summary");
  assert.equal(store.messages.at(-1)!.workspace_id, WS);
  assert.equal(store.messages[0].workspace_id, null);
});

test("running a job again changes nothing: sealed values are skipped, not sealed twice", async () => {
  const f = await fixture();
  const store = new FakeStore();
  await seed(f, store);
  const first = await runShareJob(job("to_work"), store, f.keys);
  assert.ok(first.moved > 0);
  const snapshot = structuredClone({ messages: store.messages, ai: store.ai, attachments: store.attachments, thread: store.thread_ });
  store.writes.length = 0;

  const second = await runShareJob(job("to_work"), store, f.keys);
  assert.deepEqual(second, { state: "done", moved: 0 });
  assert.deepEqual(store.writes, [], "not one write");
  assert.deepEqual({ messages: store.messages, ai: store.ai, attachments: store.attachments, thread: store.thread_ }, snapshot, "ciphertext byte for byte the same");

  store.thread_.workspace_id = null;
  await runShareJob(job("to_personal"), store, f.keys);
  const personal = structuredClone(store.messages);
  const again = await runShareJob(job("to_personal"), store, f.keys);
  assert.deepEqual(again, { state: "done", moved: 0 });
  assert.deepEqual(store.messages, personal);
});

test("a job cut off part way is finished by running it again, and rows already sealed are left alone", async () => {
  const f = await fixture();
  const store = new FakeStore();
  await seed(f, store, PAGE_ROWS + 30); // two pages of messages
  store.failWriteAfter = 1; // the first page is written, then the connection drops
  await assert.rejects(() => runShareJob(job("to_work"), store, f.keys), /connection lost/);
  const sealed = store.messages.filter((m) => m.workspace_id === WS);
  assert.equal(sealed.length, PAGE_ROWS);
  const kept = structuredClone(sealed);
  assert.equal(store.messages.length - sealed.length, 30);

  store.failWriteAfter = Infinity;
  const resumed = await runShareJob(job("to_work"), store, f.keys);
  assert.equal(resumed.state, "done");
  assert.ok(store.messages.every((m) => m.workspace_id === WS && prefixes(m).every((p) => p === "t1:")));
  assert.deepEqual(store.messages.filter((m) => kept.some((k) => k.id === m.id)), kept, "the first page was not touched again");
  assert.ok(store.ai.every((a) => a.workspace_id === WS));
});

test("a row changed between the job reading and writing it is skipped, then sealed on the next pass along with a message that arrived", async () => {
  const f = await fixture();
  const store = new FakeStore();
  await seed(f, store);
  const voice = await encryptField(f.user, FIELD.transcript, "voice words");
  const arrived = await message(f, 9, "2026-10-20T10:00:00Z");
  let landed = false;
  store.beforeWrite = (table) => {
    if (table !== "messages" || landed) return;
    landed = true;
    store.messages[1].transcript = voice; // a transcript lands after the job read the message, before it writes
    store.messages.push(arrived); // and a new message is stored
  };
  const out = await runShareJob(job("to_work"), store, f.keys);
  assert.equal(out.state, "done");
  assert.equal(store.messages.length, 4);
  assert.ok(store.messages.every((m) => m.workspace_id === WS && prefixes(m).every((p) => p === "t1:")));
  assert.equal(await decryptTeamField(f.team, FIELD.transcript, store.messages[1].transcript!), "voice words", "the new transcript was sealed, never overwritten by the stale one");
});

test("a member who has left shares nothing new: the job does nothing, and new messages stay e1 with no workspace", async () => {
  const f = await fixture();
  const store = new FakeStore();
  await seed(f, store);
  await runShareJob(job("to_work"), store, f.keys);
  store.members.set(`${WS}:${AGENT}`, "removed");
  const after = await message(f, 7, "2026-10-25T10:00:00Z");
  store.messages.push(after);
  store.ai.push(await aiRow(f, after));
  const snapshot = structuredClone(store.messages);

  const out = await runShareJob(job("to_work"), store, f.keys);
  assert.deepEqual(out, { state: "skipped", reason: "left", moved: 0 });
  assert.deepEqual(store.messages, snapshot);
  const last = store.messages.at(-1)!;
  assert.equal(last.workspace_id, null);
  assert.deepEqual([...new Set(prefixes(last))], ["e1:"]);
  // What was shared stays shared and readable by the team.
  assert.equal(store.messages[0].workspace_id, WS);
  assert.equal((await readable(f, store.messages[0])).body_html, "<p>html 1</p>");
});

test("a job for a chat that changed state meanwhile, or is gone, does nothing", async () => {
  const f = await fixture();
  const store = new FakeStore();
  await seed(f, store);
  store.thread_.workspace_id = null; // moved back before the to_work job ran
  assert.deepEqual(await runShareJob(job("to_work"), store, f.keys), { state: "skipped", reason: "changed", moved: 0 });
  assert.ok(store.messages.every((m) => m.workspace_id === null && prefixes(m).every((p) => p === "e1:")));

  store.thread_.workspace_id = WS; // and shared again before a to_personal job ran
  assert.deepEqual(await runShareJob(job("to_personal"), store, f.keys), { state: "skipped", reason: "changed", moved: 0 });
  const gone = new FakeStore();
  gone.thread = async () => null;
  assert.deepEqual(await runShareJob(job("to_work"), gone, f.keys), { state: "skipped", reason: "gone", moved: 0 });
});

test("the chat being moved back while a to_work job runs stops it, and writes nothing more", async () => {
  const f = await fixture();
  const store = new FakeStore();
  await seed(f, store, PAGE_ROWS + 5);
  store.beforeWrite = () => { store.thread_.workspace_id = null; };
  const out = await runShareJob(job("to_work"), store, f.keys);
  assert.equal(out.state, "skipped");
  assert.ok(store.messages.every((m) => m.workspace_id === null), "the database refused the writes of a chat that is no longer shared");
});

test("a value that cannot be opened is counted, and the rest of the chat still moves", async () => {
  const f = await fixture();
  const store = new FakeStore();
  await seed(f, store);
  store.messages[1].body_text = "e1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // not sealed with the agent's key
  const out = await runShareJob(job("to_work"), store, f.keys);
  assert.equal(out.state, "incomplete");
  assert.equal("failed" in out && out.failed >= 1, true);
  assert.equal(store.messages[0].workspace_id, WS);
  assert.equal(store.messages[2].workspace_id, WS);
  assert.equal(store.messages[1].workspace_id, null);
});

test("a chat of plain text is sealed too, and readable addresses are left readable", async () => {
  const f = await fixture();
  const store = new FakeStore();
  const m = await message(f, 1, "2026-10-01T10:00:00Z", { body_text: "plain words", sender_address: "plain@x.test", to_addresses: ["to@x.test"] });
  store.messages.push(m);
  store.thread_.last_message_at = m.sent_at;
  await runShareJob(job("to_work"), store, f.keys);
  assert.equal(await decryptTeamField(f.team, FIELD.body, store.messages[0].body_text!), "plain words");
  assert.equal(store.messages[0].sender_address, "plain@x.test");
  assert.deepEqual(store.messages[0].to_addresses, ["to@x.test"]);
  assert.equal(store.messages[0].workspace_id, WS);
});

test("empty values and null stay as they are", async () => {
  const f = await fixture();
  const move: Move = { direction: "to_work", userId: AGENT, workspaceId: WS };
  assert.equal(await moveValue(f.keys, move, FIELD.body, null), null);
  assert.equal(await moveValue(f.keys, move, FIELD.body, ""), "");
  const bare = { ...(await message(f, 1, "2026-10-01T00:00:00Z")), subject: null, preview: null, body_text: null, body_html: null, list_unsubscribe: null, body_marks: null, transcript: null, sender_address: null, to_addresses: [], provider_meta: {} };
  const write = await moveMessage(f.keys, move, bare);
  assert.deepEqual(Object.keys(write!.set), ["workspace_id"]);
  const placed = { ...bare, workspace_id: WS };
  assert.equal(await moveMessage(f.keys, move, placed), null, "nothing to move, already placed");
});

test("a team value cannot be opened with another team's key", async () => {
  const f = await fixture();
  const other = await deriveTeamKeys(newDataKey());
  const move: Move = { direction: "to_work", userId: AGENT, workspaceId: WS };
  const sealed = (await moveValue(f.keys, move, FIELD.body, await encryptField(f.user, FIELD.body, "x")))!;
  await assert.rejects(() => decryptTeamField(other, FIELD.body, sealed));
  await assert.rejects(() => decryptTeamField(f.team, FIELD.subject, sealed), "and not as another kind of field");
});

test("who a chat is with: the group's name, else the first person, else the subject", () => {
  assert.equal(shareLabel({ groupName: "Smith Family Trust", contactNames: ["Pat"], subject: "Hi" }), "Smith Family Trust");
  assert.equal(shareLabel({ groupName: null, contactNames: ["", " Pat Smith "], subject: "Hi" }), "Pat Smith");
  assert.equal(shareLabel({ groupName: " ", contactNames: [], subject: "Invoice 12" }), "Invoice 12");
  assert.equal(shareLabel({ groupName: null, contactNames: [], subject: null }), "Unnamed Chat");
});

test("a chat's latest message is shared when it is on or after share_from", () => {
  assert.equal(latestIsShared({ share_from: null, last_message_at: null }), true);
  assert.equal(latestIsShared({ share_from: "2026-10-02T00:00:00Z", last_message_at: "2026-10-02T00:00:00Z" }), true);
  assert.equal(latestIsShared({ share_from: "2026-10-02T00:00:00Z", last_message_at: "2026-10-01T23:59:59Z" }), false);
  assert.equal(latestIsShared({ share_from: "2026-10-02T00:00:00Z", last_message_at: null }), false);
});

test("a hot row that keeps changing ends the job as incomplete, to be tried again", async () => {
  const f = await fixture();
  const store = new FakeStore();
  await seed(f, store, 1);
  const versions = await Promise.all(Array.from({ length: MAX_PASSES + 3 }, (_, i) => encryptField(f.user, FIELD.transcript, `version ${i}`)));
  let n = 0;
  // Every write finds the message changed since it was read.
  store.beforeWrite = (table) => { if (table === "messages") store.messages[0].transcript = versions[n++]; };
  const out = await runShareJob(job("to_work"), store, f.keys);
  assert.equal(out.state, "incomplete");
  assert.equal(n, MAX_PASSES, "bounded");
  assert.equal(store.messages[0].workspace_id, null);
});
