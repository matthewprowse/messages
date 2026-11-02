// build-export.ts with a fake source: what is in the zip, progress, cancelling, failures that do not stop the rest, and files only
// when asked for.

import assert from "node:assert/strict";
import { test } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { buildExport, ExportCancelled, type ExportProgress, type ExportSource, type SourceFile } from "./build-export";

function source(over: Partial<ExportSource> = {}): ExportSource {
  return {
    threads: async () => [
      { id: "t1", title: "Ann Smith", channel: "Email", status: "inbox", lastMessageAt: "2026-11-20T08:30:00Z" },
      { id: "t2", title: "Ann Smith", channel: "WhatsApp", status: "archived", lastMessageAt: "2026-11-19T08:30:00Z" },
    ],
    messages: async (t) => [{ id: `${t.id}m`, sentAt: "2026-11-20T08:30:00Z", direction: "in", who: "Ann", text: "Hello", files: ["plan.pdf"] }],
    contacts: async () => [{ name: "Ann", emails: ["a@x.co"], phones: ["+27821234567"] }],
    notes: async () => [{ id: "n1", title: "Plan", body: "- [ ] one", pinned: true, createdAt: "2026-11-01", updatedAt: "2026-11-02" }],
    tasks: async () => [{ title: "Call Ann" }],
    events: async () => [{ id: "e1", title: "Call", startsAt: "2026-11-21T08:00:00Z", endsAt: "2026-11-21T09:00:00Z", allDay: false }],
    settings: async () => ({ displayName: "Matt", about: "Adviser" }),
    files: async () => [{ id: "f1", name: "plan.pdf", kind: "attachment", bytes: 3 }, { id: "f2", name: "plan.pdf", kind: "attachment", bytes: 3 }],
    file: async (f: SourceFile) => (f.id === "f2" ? null : new Uint8Array([1, 2, 3])),
    ...over,
  };
}

const run = async (s: ExportSource, attachments = false, signal = new AbortController().signal, progress: ExportProgress[] = []) => {
  const blob = await buildExport(s, { attachments }, (p) => progress.push(p), signal, new Date("2026-11-22T10:00:00Z"));
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
};

test("everything the person owns is in the zip, with two same-named chats kept apart", async () => {
  const out = await run(source());
  assert.deepEqual(Object.keys(out).sort(), [
    "README.txt", "calendar/events.ics", "calendar/events.json", "contacts/contacts.csv", "contacts/contacts.vcf",
    "conversations/Ann Smith (2).json", "conversations/Ann Smith (2).txt", "conversations/Ann Smith.json", "conversations/Ann Smith.txt",
    "notes/Plan.md", "profile/profile.json", "tasks/tasks.json",
  ].sort());
  assert.match(strFromU8(out["conversations/Ann Smith.txt"]), /Hello/);
  assert.equal(JSON.parse(strFromU8(out["conversations/Ann Smith.json"])).messages[0].id, "t1m");
  assert.match(strFromU8(out["notes/Plan.md"]), /^---\ntitle: "Plan"[\s\S]*- \[ \] one$/);
  assert.match(strFromU8(out["contacts/contacts.vcf"]), /FN:Ann/);
  assert.match(strFromU8(out["README.txt"]), /Conversations: 2 \(2 messages\)/);
  assert.match(strFromU8(out["README.txt"]), /Files: not included/);
});

test("files are left out unless chosen, and a missing one is reported without its contents", async () => {
  assert.ok(!Object.keys(await run(source())).some((k) => k.startsWith("files/")));
  const out = await run(source(), true);
  assert.deepEqual(Object.keys(out).filter((k) => k.startsWith("files/")), ["files/messages/plan.pdf"]);
  assert.match(strFromU8(out["problems.txt"]), /A file \(f2\)/);
});

test("one conversation that cannot be read does not stop the rest", async () => {
  const out = await run(source({ messages: async (t) => { if (t.id === "t1") throw Object.assign(new Error("secret text"), { code: "PGRST" }); return []; } }));
  assert.ok("conversations/Ann Smith.txt" in out);
  const problems = strFromU8(out["problems.txt"]);
  assert.match(problems, /t1/);
  assert.doesNotMatch(problems, /secret text/);
});

test("progress counts up through the conversations to the end", async () => {
  const progress: ExportProgress[] = [];
  await run(source(), true, new AbortController().signal, progress);
  const chats = progress.filter((p) => p.stage === "Conversations").map((p) => p.done);
  assert.deepEqual(chats, [0, 1, 2]);
  assert.equal(progress[progress.length - 1].stage, "Finishing");
  assert.ok(progress.some((p) => p.stage === "Files" && p.done === 2 && p.total === 2));
});

test("cancelling stops the build with ExportCancelled and reads nothing further", async () => {
  const controller = new AbortController();
  let reads = 0;
  const s = source({ messages: async () => { reads++; controller.abort(); return []; } });
  await assert.rejects(buildExport(s, { attachments: false }, () => undefined, controller.signal), ExportCancelled);
  assert.ok(reads <= 4);
});

test("an empty account still makes a valid zip", async () => {
  const out = await run(source({ threads: async () => [], contacts: async () => [], notes: async () => [], tasks: async () => [], events: async () => [] }));
  assert.ok("README.txt" in out && "contacts/contacts.csv" in out);
});

test("extras are written one file each, and one that cannot be read is reported without stopping the others", async () => {
  const out = await run(source({ extras: () => [
    { path: "organise/labels.json", what: "Labels", read: async () => [{ name: "Clients" }] },
    { path: "writing/signatures.json", what: "Signatures", read: async () => { throw Object.assign(new Error("secret"), { code: "PGRST" }); } },
  ] }));
  assert.equal(JSON.parse(strFromU8(out["organise/labels.json"]))[0].name, "Clients");
  assert.ok(!("writing/signatures.json" in out));
  assert.match(strFromU8(out["problems.txt"]), /Signatures: could not be read/);
  assert.doesNotMatch(strFromU8(out["problems.txt"]), /secret/);
});
