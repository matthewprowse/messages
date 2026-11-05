// The `test` every browser test imports instead of Playwright's: each browser context gets the firewall (firewall-rules.ts)
// on every request and websocket before any page opens, and a test fails at the end if anything was blocked that it did
// not declare with firewall.expect(...), naming the host. Service workers are covered by the context routing in
// Chromium only, so WebKit projects run with them blocked (playwright.config.ts). Also `me`, the test user of the
// project the test runs in, and `login`, which signs that user in without the login page (sign-in.spec.ts covers that page).

import { test as base, expect, type WebSocketRoute } from "@playwright/test";
import { describeBlocked, judge, undeclared, type Blocked, type Expectation } from "./firewall-rules";
import { storageSession } from "./session";
import { projectOf, testUserId, userEmail, type ProjectName } from "./users";
import { worldOf, type World } from "./world";

/** The allowed websockets of one context, so a test can cut them (network.offline) and let them come back. */
class Sockets {
  down = false;
  private open = new Set<WebSocketRoute>();
  add(ws: WebSocketRoute) { this.open.add(ws); ws.onClose(() => this.open.delete(ws)); }
  async close() { this.down = true; await Promise.all([...this.open].map((ws) => ws.close({ code: 1006, reason: "Offline" }))); }
  reopen() { this.down = false; }
}
const openSockets = new WeakMap<object, Sockets>();

/** What a test sees of the firewall: what it stopped so far, and a way to declare a block the test causes on purpose. */
export interface Firewall {
  blocked: Blocked[];
  expect: (what: Expectation) => void;
}

/** The test user a test runs as: the project's, its id, and what the seed made for them. */
export interface Me {
  project: ProjectName;
  email: string;
  userId: string;
  world: World;
}

/**
 * The network as a test can take it away: offline stops requests (setOffline) and also closes the Realtime sockets, which
 * Playwright proxies from outside the page and would otherwise carry on. Online lets the page's own reconnect succeed.
 */
export interface Network {
  offline: () => Promise<void>;
  online: () => Promise<void>;
}

export const test = base.extend<{ firewall: Firewall; me: Me; login: () => Promise<void>; network: Network }>({
  network: async ({ context }, use) => {
    await use({
      offline: async () => { await context.setOffline(true); await openSockets.get(context)?.close(); },
      online: async () => { await context.setOffline(false); openSockets.get(context)?.reopen(); },
    });
  },

  me: async ({}, use, testInfo) => {
    const project = projectOf(testInfo.project.name);
    await use({ project, email: userEmail(project), userId: await testUserId(project), world: worldOf(project) });
  },

  // Puts the project user's session where the app keeps it, before any page script runs. Call it before the first goto.
  login: async ({ context, me }, use) => {
    await use(async () => {
      const { key, value } = await storageSession(me.project);
      await context.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [key, value]);
    });
  },

  firewall: async ({}, use) => {
    const expected: Expectation[] = [];
    const firewall: Firewall = { blocked: [], expect: (what) => void expected.push(what) };
    await use(firewall);
    const surprises = undeclared(firewall.blocked, expected);
    if (surprises.length) throw new Error(describeBlocked(surprises));
  },

  context: async ({ context, firewall }, use) => {
    const sockets = new Sockets();
    openSockets.set(context, sockets);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const stop = judge(request.url(), request.method(), request.postData());
      if (!stop) return route.continue();
      firewall.blocked.push(stop);
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket(() => true, (ws) => {
      const stop = judge(ws.url());
      if (stop) {
        firewall.blocked.push(stop);
        ws.close({ code: 1008, reason: "Blocked by the test firewall" });
        return;
      }
      if (sockets.down) return void ws.close({ code: 1006, reason: "Offline" });
      ws.connectToServer();
      sockets.add(ws);
    });
    await use(context);
  },
});

export { expect };
