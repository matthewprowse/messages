import { test } from "node:test";
import assert from "node:assert/strict";
import { Helper, HelperError, type HelperEvent, type Transport } from "./helper";

// A stand-in for the helper process: it records what the worker writes and answers as the Go program would.
class FakeHelper implements Transport {
  written: { id: number; cmd: string; args?: unknown }[] = [];
  private lineListener: (line: string) => void = () => undefined;
  private exitListener: () => void = () => undefined;
  closed = false;
  constructor(private readonly answer: (req: { id: number; cmd: string; args?: unknown }) => unknown) {}
  write(line: string) {
    const req = JSON.parse(line);
    this.written.push(req);
    const reply = this.answer(req);
    if (reply !== undefined) queueMicrotask(() => this.lineListener(JSON.stringify(reply)));
  }
  onLine(listener: (line: string) => void) {
    this.lineListener = listener;
  }
  onExit(listener: () => void) {
    this.exitListener = listener;
  }
  close() {
    this.closed = true;
  }
  emit(value: unknown) {
    this.lineListener(typeof value === "string" ? value : JSON.stringify(value));
  }
  exit() {
    this.exitListener();
  }
}

const me = { id: "ACoAAME", urn: "urn:li:fsd_profile:ACoAAME", kind: "member" as const, firstName: "Test", lastName: "Owner" };

test("commands go out as JSON lines and their answers come back by id", async () => {
  const fake = new FakeHelper((req) => (req.cmd === "login" ? { id: req.id, ok: true, result: { me } } : { id: req.id, ok: true, result: {} }));
  const helper = new Helper(fake, () => undefined);
  const result = await helper.call("login", { cookies: "li_at=a; JSESSIONID=\"ajax:1\"" });
  assert.deepEqual(result.me, me);
  await helper.call("connect", {});
  assert.deepEqual(fake.written, [
    { id: 1, cmd: "login", args: { cookies: "li_at=a; JSESSIONID=\"ajax:1\"" } },
    { id: 2, cmd: "connect", args: {} },
  ]);
});

test("answers out of order still reach the right call", async () => {
  const held: { id: number }[] = [];
  const fake = new FakeHelper((req) => void held.push(req));
  const helper = new Helper(fake, () => undefined);
  const first = helper.call("messages", { conversation: "urn:li:msg_conversation:(a,1)" });
  const second = helper.call("messages", { conversation: "urn:li:msg_conversation:(a,2)" });
  fake.emit({ id: held[1].id, ok: true, result: { messages: [{ urn: "two" }] } });
  fake.emit({ id: held[0].id, ok: true, result: { messages: [{ urn: "one" }] } });
  assert.equal((await first).messages[0].urn, "one");
  assert.equal((await second).messages[0].urn, "two");
});

test("a failed command rejects with its kind and status, never LinkedIn's words", async () => {
  const fake = new FakeHelper((req) => ({ id: req.id, ok: false, error: { kind: "rate_limited", status: 429 } }));
  const helper = new Helper(fake, () => undefined);
  await assert.rejects(helper.call("changes", {}), (err: unknown) => {
    assert.ok(err instanceof HelperError);
    assert.equal(err.kind, "rate_limited");
    assert.equal(err.status, 429);
    assert.equal(err.code, "rate_limited");
    return true;
  });
});

test("events are passed on, and lines that are not the protocol are ignored", () => {
  const events: HelperEvent[] = [];
  const fake = new FakeHelper(() => undefined);
  new Helper(fake, (e) => events.push(e));
  fake.emit({ event: "ready" });
  fake.emit("panic: something");
  fake.emit({ event: "message", message: { urn: "m1", conversationUrn: "c1", deliveredAt: 1, text: "Hi" } });
  fake.emit({ id: 99, ok: true }); // an answer nobody is waiting for
  assert.deepEqual(events.map((e) => e.event), ["ready", "message"]);
});

test("when the process exits, waiting calls fail and the session hears it", async () => {
  const events: HelperEvent[] = [];
  const fake = new FakeHelper(() => undefined);
  const helper = new Helper(fake, (e) => events.push(e));
  const waiting = helper.call("changes", {});
  fake.exit();
  await assert.rejects(waiting, (err: unknown) => err instanceof HelperError && err.kind === "exited");
  await assert.rejects(helper.call("connect", {}), (err: unknown) => err instanceof HelperError && err.kind === "exited");
  assert.equal(helper.alive, false);
  assert.deepEqual(events, [{ event: "failed", error: { kind: "failed" } }]);
});

test("a call with no answer times out", async () => {
  const helper = new Helper(new FakeHelper(() => undefined), () => undefined);
  await assert.rejects(helper.call("read", { conversation: "c" }, 10), (err: unknown) => err instanceof HelperError && err.kind === "timeout");
});

test("stop asks the helper to stop, then closes it", async () => {
  const fake = new FakeHelper((req) => ({ id: req.id, ok: true, result: {} }));
  const helper = new Helper(fake, () => undefined);
  await helper.stop();
  assert.equal(fake.written[0].cmd, "stop");
  assert.equal(fake.closed, true);
});
