// Tests for linkedin/helper.ts against a fake transport: the JSON line protocol, error kinds, timeouts and
// shutdown, sign-in commands, and how a proxy is passed to and vetted for the helper.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Helper, HelperError, allowedEnv, helperEnv, vettedProxy, type HelperEvent, type Transport } from "./helper";

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

test("a sign-in goes out as commands and comes back as a state, or as an error with its stage", async () => {
  const headers = { "User-Agent": ["Mozilla/5.0 Test"] };
  const fake = new FakeHelper((req) => {
    if (req.cmd === "signin") return { id: req.id, ok: true, result: { state: "code", method: "email" } };
    if (req.cmd === "code") return { id: req.id, ok: true, result: { state: "done", cookies: "li_at=a; JSESSIONID=ajax:1", headers } };
    return { id: req.id, ok: false, error: { kind: "rejected", status: 200, stage: "authenticate" } };
  });
  const helper = new Helper(fake, () => undefined);
  assert.deepEqual(await helper.call("signin", { email: "a@example.com", password: "x", proxy: "http://127.0.0.1:8080" }), { state: "code", method: "email" });
  assert.deepEqual(await helper.call("code", { code: "123456" }), { state: "done", cookies: "li_at=a; JSESSIONID=ajax:1", headers });
  assert.deepEqual(fake.written[0], { id: 1, cmd: "signin", args: { email: "a@example.com", password: "x", proxy: "http://127.0.0.1:8080" } });
  await assert.rejects(helper.call("another_way", {}), (err: unknown) => err instanceof HelperError && err.kind === "rejected" && err.status === 200 && err.stage === "authenticate");
});

test("login carries the browser headers the session was created with", async () => {
  const fake = new FakeHelper((req) => ({ id: req.id, ok: true, result: { me } }));
  const helper = new Helper(fake, () => undefined);
  await helper.call("login", { cookies: "li_at=a; JSESSIONID=\"ajax:1\"", headers: { "User-Agent": ["Mozilla/5.0 Test"] } });
  assert.deepEqual(fake.written[0].args, { cookies: "li_at=a; JSESSIONID=\"ajax:1\"", headers: { "User-Agent": ["Mozilla/5.0 Test"] } });
});

test("a proxy reaches the helper as the standard proxy variables, and an old one does not", () => {
  const base = { PATH: "/bin", HTTPS_proxy: "ignored", https_proxy: "http://elsewhere:1", HTTP_PROXY: "http://elsewhere:1" };
  const withProxy = helperEnv(" socks5://user:pass@proxy.example:1080 ", base);
  assert.equal(withProxy.HTTPS_PROXY, "socks5://user:pass@proxy.example:1080");
  assert.equal(withProxy.HTTP_PROXY, "socks5://user:pass@proxy.example:1080");
  assert.equal(withProxy.https_proxy, undefined);
  assert.equal(withProxy.PATH, "/bin");
  const without = helperEnv(undefined, base);
  assert.equal(without.HTTPS_PROXY, undefined);
  assert.equal(without.HTTP_PROXY, undefined);
  assert.equal(without.https_proxy, undefined);
  assert.equal(without.PATH, "/bin");
  assert.equal(base.HTTP_PROXY, "http://elsewhere:1", "the environment given is not changed");
});

test("the helper gets an allow-listed environment and no secrets", () => {
  const base = { PATH: "/bin", HOME: "/h", LC_ALL: "C", LANG: "en", SUPABASE_SERVICE_ROLE_KEY: "s", KEY_WRAPPING_KEY: "k", ENCRYPTION_KEY: "e", GEMINI_API_KEY: "g", HTTPS_PROXY: "http://old:1" };
  assert.deepEqual(allowedEnv(base), { PATH: "/bin", HOME: "/h", LC_ALL: "C", LANG: "en" });
  const env = helperEnv("http://p.example:1", base);
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "KEY_WRAPPING_KEY", "ENCRYPTION_KEY", "GEMINI_API_KEY"]) assert.equal(env[name], undefined);
  assert.equal(env.HTTPS_PROXY, "http://p.example:1");
});

test("a proxy is vetted at connect time: public hosts pass, names that resolve privately do not", async () => {
  const dns: Record<string, string | null> = { "proxy.example": "93.184.216.34", "127.0.0.1.nip.io": null, "meta.example": null };
  const resolve = async (host: string) => dns[host] ?? null;
  assert.equal(await vettedProxy("http://u:p@proxy.example:8080", resolve), "http://u:p@93.184.216.34:8080");
  assert.equal(await vettedProxy("socks5://proxy.example:1080", resolve), "socks5://93.184.216.34:1080");
  assert.equal(await vettedProxy("https://proxy.example:443", resolve), "https://proxy.example");
  assert.equal(await vettedProxy("http://8.8.8.8:3128", resolve), "http://8.8.8.8:3128");
  for (const bad of ["http://127.0.0.1.nip.io:8080", "http://meta.example", "http://169.254.169.254", "http://[::ffff:7f00:1]:80", "http://[64:ff9b::7f00:1]", "nonsense"]) {
    assert.equal(await vettedProxy(bad, resolve), null, bad);
  }
});
