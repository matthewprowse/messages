// request.ts: this app's origin comes from APP_URL in production (a preview's own Vercel address in a preview) and never
// from request headers, the caller's address trusts only Vercel's own header there, and a capped body read stops at the cap.

import assert from "node:assert/strict";
import { test } from "node:test";
import { appOrigin, clientAddress, foreignOrigin, isProduction, limitedAddress, readCapped } from "./request";

const dev = { NODE_ENV: "development" };
const prod = { NODE_ENV: "production", APP_URL: "https://app.konva.example/" };
const prodNoUrl = { NODE_ENV: "production" };
const headed = (headers: Record<string, string>) => new Request("http://internal:3000/api/x", { headers });

test("production is NODE_ENV or VERCEL_ENV production", () => {
  assert.ok(isProduction({ NODE_ENV: "production" }));
  assert.ok(isProduction({ VERCEL_ENV: "production" }));
  assert.ok(!isProduction(dev));
  assert.ok(!isProduction({}));
});

test("APP_URL wins over any header, trailing slash dropped", () => {
  const request = headed({ host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" });
  assert.equal(appOrigin(request, prod), "https://app.konva.example");
  assert.equal(appOrigin(request, { ...dev, APP_URL: "http://localhost:3000" }), "http://localhost:3000");
});

test("in production without APP_URL there is no origin to trust, and every Origin is foreign", () => {
  const request = headed({ host: "app.konva.example", origin: "https://app.konva.example" });
  assert.throws(() => appOrigin(request, prodNoUrl));
  assert.throws(() => appOrigin(request, { NODE_ENV: "production", APP_URL: "https://app.konva.example/path" }));
  assert.equal(foreignOrigin(request, prodNoUrl), true);
});

test("a preview uses its own Vercel address, never APP_URL or a header it did not set", () => {
  const preview = { NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_URL: "konva-abc123.vercel.app", VERCEL_BRANCH_URL: "konva-git-fix.vercel.app", APP_URL: "https://app.konva.example" };
  assert.equal(appOrigin(headed({ host: "konva-abc123.vercel.app" }), preview), "https://konva-abc123.vercel.app");
  assert.equal(appOrigin(headed({ host: "konva-git-fix.vercel.app" }), preview), "https://konva-git-fix.vercel.app");
  assert.equal(appOrigin(headed({ host: "evil.example", "x-forwarded-host": "evil.example" }), preview), "https://konva-git-fix.vercel.app");
  assert.equal(appOrigin(headed({}), { ...preview, VERCEL_BRANCH_URL: undefined }), "https://konva-abc123.vercel.app");
  assert.equal(foreignOrigin(headed({ host: "konva-git-fix.vercel.app", origin: "https://konva-abc123.vercel.app" }), preview), false);
  assert.equal(foreignOrigin(headed({ host: "konva-git-fix.vercel.app", origin: "https://konva-git-fix.vercel.app" }), preview), false);
  assert.equal(foreignOrigin(headed({ origin: "https://app.konva.example" }), preview), true);
  assert.equal(foreignOrigin(headed({ origin: "https://evil.example", host: "evil.example" }), preview), true);
});

test("a preview without Vercel's address has no origin, and Vercel production still needs APP_URL", () => {
  const request = headed({ host: "konva-abc123.vercel.app", origin: "https://konva-abc123.vercel.app" });
  assert.throws(() => appOrigin(request, { NODE_ENV: "production", VERCEL_ENV: "preview" }));
  assert.equal(foreignOrigin(request, { NODE_ENV: "production", VERCEL_ENV: "preview" }), true);
  const production = { NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_URL: "konva-abc123.vercel.app" };
  assert.throws(() => appOrigin(request, production));
  assert.equal(foreignOrigin(request, production), true);
  assert.equal(appOrigin(request, { ...production, APP_URL: "https://app.konva.example" }), "https://app.konva.example");
});

test("locally the request's own headers name the origin", () => {
  assert.equal(appOrigin(headed({ host: "localhost:3000" }), dev), "http://localhost:3000");
  assert.equal(appOrigin(headed({ "x-forwarded-host": "tunnel.example", "x-forwarded-proto": "https" }), dev), "https://tunnel.example");
});

test("an Origin is ours only when it matches APP_URL's host", () => {
  assert.equal(foreignOrigin(headed({ origin: "https://app.konva.example" }), prod), false);
  assert.equal(foreignOrigin(headed({ origin: "https://evil.example", "x-forwarded-host": "evil.example" }), prod), true);
  assert.equal(foreignOrigin(headed({ origin: "not a url" }), prod), true);
  assert.equal(foreignOrigin(headed({}), prod), false);
});

test("in production only Vercel's own address header counts", () => {
  assert.equal(clientAddress(headed({ "x-vercel-forwarded-for": "1.2.3.4, 5.6.7.8", "x-real-ip": "9.9.9.9" }), prod), "1.2.3.4");
  assert.equal(clientAddress(headed({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "8.8.8.8" }), prod), "unknown");
  assert.equal(clientAddress(headed({ "x-real-ip": "9.9.9.9" }), dev), "9.9.9.9");
  assert.equal(clientAddress(headed({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" }), dev), "7.7.7.7");
  assert.equal(clientAddress(headed({}), dev), "unknown");
});

test("a capped read returns the body under the cap and null over it", async () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request("http://x/", { method: "POST", body, headers });
  assert.equal(await readCapped(post("hello"), 10), "hello");
  assert.equal(await readCapped(post("hello world"), 10), null);
  assert.equal(await readCapped(post("hi", { "content-length": "999999" }), 10), null);
  assert.equal(await readCapped(new Request("http://x/"), 10), "");
});

test("a streamed body with no length is cut off at the cap", async () => {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1024));
      if (pulled > 1000) controller.close();
    },
  });
  const request = new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  assert.equal(await readCapped(request, 4096), null);
  assert.ok(pulled < 20);
});

test("a route limited by address alone refuses an unnamed caller in production and serves one locally", () => {
  const prod = { NODE_ENV: "production", VERCEL_ENV: "production" } as NodeJS.ProcessEnv;
  const dev = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
  assert.equal(limitedAddress(headed({ "x-vercel-forwarded-for": "1.2.3.4" }), prod), "1.2.3.4");
  assert.equal(limitedAddress(headed({ "x-forwarded-for": "8.8.8.8" }), prod), null);
  assert.equal(limitedAddress(headed({}), dev), "unknown");
});
