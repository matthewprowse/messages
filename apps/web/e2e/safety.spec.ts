// The Safety Rule, proved (docs/TESTING.md): the tests only reach Konva Test, the test server holds no production
// setting and its build no production reference, the browser firewall blocks and names everything else (websockets and
// sign-in emails too), service workers cannot slip past it, no worker runs against Konva Test, and the seeded data is
// made up with no sign-in to send through. Checks of settings and files run once, on Desktop; browser checks run on all three.

import { FORBIDDEN_REFS, TEST_HOST, TEST_REF, TEST_URL, assertTestUrl, checkTestEnv, loadTestEnv, serverEnv, FORBIDDEN_SERVER_KEY } from "./support/test-env";
import { filesMentioning, proveServerEnv, scanBuild } from "./support/server-proof";
import { judge, undeclared } from "./support/firewall-rules";
import { admin } from "./support/admin";
import { ACCOUNT, PEOPLE } from "./support/fake-data";
import { WA_ACCOUNT, WA_PEOPLE } from "./support/fake-chats";
import { PROJECTS, testUserId, userEmail } from "./support/users";
import { expect, test } from "./support/fixtures";

const PRODUCTION_URL = `https://${FORBIDDEN_REFS.production}.supabase.co`;
const MARKETING_URL = `https://${FORBIDDEN_REFS.marketing}.supabase.co`;

/** A fetch from the page that reports whether it got through, never its content. */
const tryFetch = (url: string) => fetch(url, { mode: "no-cors" }).then(() => "reached", () => "failed");

test.describe("settings and files", () => {
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "Desktop", "Not about a screen: once per run is enough."));

  test("the settings point at Konva Test, and production or Marketing settings are refused", () => {
    const env = loadTestEnv();
    expect(env.SUPABASE_URL).toBe(TEST_URL);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(TEST_URL);
    expect(() => checkTestEnv({ ...env, SUPABASE_URL: PRODUCTION_URL })).toThrow(/not Konva Test/);
    expect(() => checkTestEnv({ ...env, NEXT_PUBLIC_SUPABASE_URL: MARKETING_URL })).toThrow(/not Konva Test/);
    expect(() => checkTestEnv({ ...env, SOME_OTHER_SETTING: `see ${FORBIDDEN_REFS.production}` })).toThrow(/mentions the production project/);
    expect(() => checkTestEnv({ ...env, SOME_OTHER_SETTING: FORBIDDEN_REFS.marketing })).toThrow(/mentions the marketing project/);
    expect(() => checkTestEnv({ ...env, KEY_WRAPPING_KEY: "a-production-secret-value" }, ["a-production-secret-value"])).toThrow(/same value as a production setting/);
    expect(() => checkTestEnv({ ...env, TEST_USER_EMAIL: "someone@gmail.com" })).toThrow(/made-up example.com/);
  });

  test("the seed and the fake worker refuse any database but Konva Test", () => {
    expect(assertTestUrl(TEST_URL)).toBe(TEST_URL);
    for (const url of [PRODUCTION_URL, MARKETING_URL, `${TEST_URL}.evil.example`, undefined]) expect(() => assertTestUrl(url)).toThrow(/refused/);
  });

  test("the test server's environment holds no production setting", () => {
    const env = serverEnv(loadTestEnv());
    expect(env.NODE_ENV).toBe("test");
    expect(Object.keys(env).filter((k) => FORBIDDEN_SERVER_KEY.test(k) || k.startsWith("TEST_USER_"))).toEqual([]);
    // What Next's own env loader gives the server, beside apps/web/.env.local: names only on failure.
    expect(proveServerEnv(loadTestEnv())).toEqual([]);
  });

  test("the test build holds no production reference or secret", () => {
    // Control: the scan does find what a build must hold, the test project's address inlined into the browser code.
    expect(filesMentioning([TEST_REF]).length).toBeGreaterThan(0);
    expect(scanBuild()).toEqual([]);
  });

  test("the firewall lets only the test server and the test database through", () => {
    expect(judge("http://localhost:3100/inbox")).toBeNull();
    expect(judge(`${TEST_URL}/rest/v1/threads`)).toBeNull();
    expect(judge(`wss://${TEST_HOST}/realtime/v1/websocket`)).toBeNull();
    expect(judge("http://localhost:3000/inbox")?.host).toBe("localhost:3000");
    expect(judge(`${PRODUCTION_URL}/rest/v1/threads`)?.host).toBe(`${FORBIDDEN_REFS.production}.supabase.co`);
    expect(judge("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", "POST")?.host).toBe("gmail.googleapis.com");
    expect(judge(`${TEST_URL}/auth/v1/otp`, "POST")?.reason).toMatch(/sends email/);
    expect(judge(`${TEST_URL}/auth/v1/user`, "PUT", '{"email":"x@example.com"}')?.reason).toMatch(/email change/);
    expect(judge(`${TEST_URL}/auth/v1/user`, "PUT", '{"data":{"tour":"done"}}')).toBeNull();
    const blocked = [judge("https://graph.microsoft.com/v1.0/me")!, judge("https://gmail.googleapis.com/x")!];
    expect(undeclared(blocked, ["gmail.googleapis.com"]).map((b) => b.host)).toEqual(["graph.microsoft.com"]);
  });

  test("the seeded data is made up and its accounts have no sign-in to send through", async () => {
    for (const p of [...PEOPLE, ACCOUNT]) expect(p.address).toMatch(/@example\.(com|org|net)$/);
    // The 555 01xx range is reserved for fiction.
    for (const p of [...WA_PEOPLE, { phone: WA_ACCOUNT.phone }]) expect(p.phone).toMatch(/^\+1555555010\d$/);
    const db = admin();
    for (const project of PROJECTS) {
      expect(userEmail(project)).toMatch(/^konva-test-[a-z]+@example\.com$/);
      const { data: accounts, error } = await db.from("accounts").select("id, provider, status").eq("user_id", await testUserId(project));
      expect(error).toBeNull();
      expect(accounts!.map((a) => a.provider).sort()).toEqual([ACCOUNT.provider, "google_calendar", "google_tasks", WA_ACCOUNT.provider].sort());
      const ids = accounts!.map((a) => a.id);
      const { count } = await db.from("account_credentials").select("account_id", { count: "exact", head: true }).in("account_id", ids);
      expect(count).toBe(0);
      const { count: keys } = await db.from("whatsapp_auth_keys").select("account_id", { count: "exact", head: true }).in("account_id", ids);
      expect(keys).toBe(0);
    }
  });

  test("no worker runs against Konva Test: a queued row stays unclaimed", async () => {
    const db = admin();
    const userId = await testUserId("Desktop");
    // A conversation you answered last, which no other test queues anything for.
    const { data: thread } = await db.from("threads").select("id").eq("user_id", userId).eq("last_from_me", true).limit(1).single();
    const { data: row, error } = await db.from("mail_actions").insert({ user_id: userId, thread_id: thread!.id, action: "read" }).select("id").single();
    expect(error).toBeNull();
    try {
      // A worker picks a queued row up within a second or two (Realtime, then a poll); five seconds is plenty.
      await new Promise((r) => setTimeout(r, 5_000));
      const { data: after } = await db.from("mail_actions").select("status, claimed_at").eq("id", row!.id).single();
      expect(after).toEqual({ status: "queued", claimed_at: null });
    } finally {
      await db.from("mail_actions").delete().eq("id", row!.id);
    }
  });
});

test.describe("the browser firewall", () => {
  test("a request to a mail provider is blocked and named", async ({ page, firewall }) => {
    firewall.expect("gmail.googleapis.com");
    // A page of the app could not even try: its Content Security Policy stops the fetch inside the browser. So the firewall
    // is tested on its own: a navigation, and a fetch from a blank page, which have no such policy in front of them.
    await page.goto("about:blank");
    expect(await page.evaluate(tryFetch, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send")).toBe("failed");
    await expect(page.goto("https://gmail.googleapis.com/gmail/v1/users/me/messages")).rejects.toThrow();
    expect(firewall.blocked.map((b) => `${b.host}${b.path}`)).toEqual(["gmail.googleapis.com/gmail/v1/users/me/messages/send", "gmail.googleapis.com/gmail/v1/users/me/messages"]);
  });

  test("a websocket to anywhere but the test database is blocked, and the test database's is let through", async ({ page, firewall }) => {
    firewall.expect("realtime.example.com");
    // From a blank page, so the app's Content Security Policy is not what stops it (see above).
    await page.goto("about:blank");
    const outcome = (url: string) => page.evaluate((u) => new Promise<string>((done) => {
      const ws = new WebSocket(u);
      ws.onopen = () => { ws.close(); done("open"); };
      ws.onclose = () => done("closed");
      setTimeout(() => done("timeout"), 10_000);
    }), url);
    expect(await outcome("wss://realtime.example.com/socket")).toBe("closed");
    expect(firewall.blocked.filter((b) => b.kind === "websocket").map((b) => b.host)).toEqual(["realtime.example.com"]);
    const key = loadTestEnv().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(await outcome(`wss://${TEST_HOST}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`)).toBe("open");
  });

  test("a sign-in code request never reaches the mailer", async ({ page, firewall }) => {
    firewall.expect(/\/auth\/v1\/otp$/);
    await page.goto("/login");
    await page.getByLabel("Email").fill(userEmail("Desktop"));
    await page.getByRole("button", { name: "Continue With Email" }).click();
    await expect(page.getByText("That email could not be used")).toBeVisible();
    expect(firewall.blocked.map((b) => `${b.host}${b.path}`)).toContain(`${TEST_HOST}/auth/v1/otp`);
  });

  test("a blocked request the test did not declare fails the test", async ({ page }) => {
    // Expected to fail: the firewall fixture throws at the end, naming api.example.com.
    test.fail();
    await page.goto("about:blank");
    expect(await page.evaluate(tryFetch, "https://api.example.com/v1/anything")).toBe("failed");
  });

  test("service workers cannot run where the firewall cannot see their requests", async ({ page }, testInfo) => {
    await page.goto("/login");
    const result = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "unavailable";
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch {
        return "refused";
      }
      return (await navigator.serviceWorker.getRegistrations()).length ? "registered" : "refused";
    });
    // Chromium routes a service worker's requests through the context firewall, so it may register (and that it does shows
    // this check can tell). WebKit does not route them, so there service workers are blocked outright.
    if ((testInfo.project.use.defaultBrowserType ?? "chromium") === "chromium") expect(result).toBe("registered");
    else {
      expect(testInfo.project.use.serviceWorkers).toBe("block");
      expect(result).not.toBe("registered");
    }
  });
});
