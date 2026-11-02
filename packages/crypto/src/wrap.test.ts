// Tests for crypto/wrap.ts: local and KMS key wrappers, per-user and team data keys, Google access tokens for
// the KMS call, and sealed credentials, against fakes of the key tables and Google's endpoints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  dataKeyFor, deriveCredentialKey, googleAccessToken, kmsWrapper, localWrapper, openCredential, sealCredential, teamDataKeyFor, teamKeyring, wrappersFromEnv,
  type KeyStore, type TeamKeyRow, type TeamKeyStore,
} from "./wrap";

const vectors = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url), "utf8"));
const credVectors = JSON.parse(readFileSync(new URL("../credential-vectors.json", import.meta.url), "utf8"));

test("the local wrapper unwraps the saved key, and only for the user it was wrapped for", async () => {
  const w = await localWrapper(vectors.localWrap.masterKeyBase64);
  const key = await w.unwrap(vectors.localWrap.wrapped, vectors.localWrap.userId);
  assert.equal(Buffer.from(key).toString("hex"), vectors.dataKeyHex);
  await assert.rejects(w.unwrap(vectors.localWrap.wrapped, "someone-else"));
});

test("dataKeyFor creates a key once and returns the same one after", async () => {
  const rows = new Map<string, { wrapped_key: string; wrapped_by: string }>();
  const store: KeyStore = {
    read: async (id) => rows.get(id) ?? null,
    insertIfAbsent: async (r) => { if (!rows.has(r.user_id)) rows.set(r.user_id, r); },
  };
  const w = await localWrapper(vectors.localWrap.masterKeyBase64);
  const a = await dataKeyFor(store, [w], "u1");
  const b = await dataKeyFor(store, [w], "u1");
  assert.deepEqual(a, b);
  assert.equal(rows.size, 1);
  assert.equal(a.length, 32);
});

test("the local wrapper unwraps the saved team key, and only for the workspace it was wrapped for", async () => {
  const w = await localWrapper(vectors.teamWrap.masterKeyBase64);
  const key = await w.unwrap(vectors.teamWrap.wrapped, vectors.teamWrap.workspaceId, "team");
  assert.equal(Buffer.from(key).toString("hex"), vectors.teamDataKeyHex);
  await assert.rejects(w.unwrap(vectors.teamWrap.wrapped, "another-workspace", "team"));
  // A team key cannot be opened as a user's, even when the ID is the same.
  await assert.rejects(w.unwrap(vectors.teamWrap.wrapped, vectors.teamWrap.workspaceId));
  await assert.rejects(w.unwrap(vectors.localWrap.wrapped, vectors.localWrap.userId, "team"));
});

test("wrapping a user's key leaves its bytes and additional data alone: the saved wrapped key still opens", async () => {
  const w = await localWrapper(vectors.localWrap.masterKeyBase64);
  const key = Uint8Array.from(Buffer.from(vectors.dataKeyHex, "hex"));
  // Wrapped by this code, it opens with the explicit "user" scope and the default one alike.
  const wrapped = await w.wrap(key, vectors.localWrap.userId);
  assert.deepEqual(await w.unwrap(wrapped, vectors.localWrap.userId, "user"), key);
  assert.deepEqual(await w.unwrap(vectors.localWrap.wrapped, vectors.localWrap.userId, "user"), key);
});

// A fake in-memory team_keys table.
function fakeTeamStore(): TeamKeyStore & { rows: Map<number, TeamKeyRow>; due: boolean; created(): number } {
  const rows = new Map<number, TeamKeyRow>();
  let creates = 0;
  const store = {
    rows,
    due: false,
    created: () => creates,
    list: async () => [...rows.values()],
    insertVersion: async (r: TeamKeyRow & { workspace_id: string }) => {
      if (rows.has(r.key_version)) return; // the first insert of a version wins
      creates++;
      rows.set(r.key_version, { key_version: r.key_version, wrapped_key: r.wrapped_key, wrapped_by: r.wrapped_by, retired_at: null });
      store.due = false; // a version made after the removal answers it
    },
    rotationDue: async () => store.due,
  };
  return store;
}

test("teamDataKeyFor creates a key once, returns the same one after, and keeps the first of two racing creates", async () => {
  const stores = new Map<string, ReturnType<typeof fakeTeamStore>>();
  const storeFor = (id: string) => stores.get(id) ?? stores.set(id, fakeTeamStore()).get(id)!;
  const w = await localWrapper(vectors.localWrap.masterKeyBase64);
  const [a, b] = await Promise.all([teamDataKeyFor(storeFor("w1"), [w], "w1"), teamDataKeyFor(storeFor("w1"), [w], "w1")]);
  const c = await teamDataKeyFor(storeFor("w1"), [w], "w1");
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(storeFor("w1").rows.size, 1);
  assert.equal(c.length, 32);
  assert.equal(storeFor("w1").rows.get(1)?.wrapped_by, "local:v1");
  assert.notDeepEqual(await teamDataKeyFor(storeFor("w2"), [w], "w2"), c);
  // A row moved to another workspace does not open.
  const moved = fakeTeamStore();
  moved.rows.set(1, storeFor("w1").rows.get(1)!);
  await assert.rejects(teamDataKeyFor(moved, [w], "w3"));
});

test("a removal makes a new team key version once, keeps the old one readable, and the old key is not the current", async () => {
  const store = fakeTeamStore();
  const w = await localWrapper(vectors.localWrap.masterKeyBase64);
  const first = await teamKeyring(store, [w], "w1");
  assert.equal(first.current.version, 1);
  store.due = true; // a member was removed
  const [a, b] = await Promise.all([teamKeyring(store, [w], "w1"), teamKeyring(store, [w], "w1")]);
  assert.equal(a.current.version, 2);
  assert.equal(b.current.version, 2);
  assert.equal(store.created(), 2); // version 1 and version 2, not 3
  assert.deepEqual(a.current.key, b.current.key);
  assert.notDeepEqual(a.current.key, first.current.key);
  assert.deepEqual(a.all.map((k) => k.version), [2, 1]);
  assert.deepEqual(a.all[1].key, first.current.key);
  // Nothing more is made once the removal is answered.
  assert.equal((await teamKeyring(store, [w], "w1")).current.version, 2);
  assert.equal(store.created(), 2);
});

test("a retired version is left out of what readers try, but the first version stays as the index root", async () => {
  const store = fakeTeamStore();
  const w = await localWrapper(vectors.localWrap.masterKeyBase64);
  const first = await teamKeyring(store, [w], "w1");
  assert.equal(first.indexRoot.version, 1);
  store.due = true;
  await teamKeyring(store, [w], "w1");
  store.due = true;
  const third = await teamKeyring(store, [w], "w1");
  assert.deepEqual(third.all.map((k) => k.version), [3, 2, 1]);
  assert.equal(third.indexRoot.version, 1); // the index root does not move on a rotation
  assert.deepEqual(third.indexRoot.key, first.current.key);
  store.rows.get(1)!.retired_at = "2026-11-02T00:00:00Z";
  store.rows.get(2)!.retired_at = "2026-11-02T00:00:00Z";
  const ring = await teamKeyring(store, [w], "w1");
  assert.deepEqual(ring.all.map((k) => k.version), [3]);
  assert.equal(ring.current.version, 3);
  assert.equal(ring.indexRoot.version, 1);
  assert.deepEqual(ring.indexRoot.key, first.current.key);
});

// A fake Cloud KMS: AES-GCM under a key of its own, additional data checked, like the real one. It records calls.
async function fakeKms(): Promise<{ url: string; server: Server; calls: { path: string; auth: string | undefined }[]; close(): Promise<void> }> {
  const master = randomBytes(32);
  const calls: { path: string; auth: string | undefined }[] = [];
  const read = (req: IncomingMessage) => new Promise<string>((resolve) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => resolve(s)); });
  const server = createServer(async (req, res) => {
    calls.push({ path: req.url ?? "", auth: req.headers.authorization });
    const body = JSON.parse(await read(req));
    const aad = Buffer.from(body.additionalAuthenticatedData ?? "", "base64");
    try {
      if (req.url?.endsWith(":encrypt")) {
        const iv = randomBytes(12);
        const c = createCipheriv("aes-256-gcm", master, iv);
        c.setAAD(aad);
        const ct = Buffer.concat([c.update(Buffer.from(body.plaintext, "base64")), c.final()]);
        res.end(JSON.stringify({ ciphertext: Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64") }));
      } else if (req.url?.endsWith(":decrypt")) {
        const raw = Buffer.from(body.ciphertext, "base64");
        const d = createDecipheriv("aes-256-gcm", master, raw.subarray(0, 12));
        d.setAAD(aad);
        d.setAuthTag(raw.subarray(raw.length - 16));
        res.end(JSON.stringify({ plaintext: Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString("base64") }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: "decryption failed: the ciphertext is invalid" } }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server, calls, close: () => new Promise((r) => server.close(() => r())) };
}

const KEY_NAME = "projects/messages-keys/locations/africa-south1/keyRings/messages/cryptoKeys/user-data-keys";

test("the KMS wrapper round-trips a key, binds it to its owner and scope, and sends the bearer token", async () => {
  const kms = await fakeKms();
  try {
    const w = kmsWrapper({ keyName: KEY_NAME, token: async () => "tok-1", endpoint: kms.url });
    assert.equal(w.id, "kms:v1");
    const key = randomBytes(32);
    const data = Uint8Array.from(key);
    const wrapped = await w.wrap(data, "user-1");
    assert.deepEqual(Buffer.from(await w.unwrap(wrapped, "user-1")), key);
    assert.equal(kms.calls[0].path, `/v1/${KEY_NAME}:encrypt`);
    assert.equal(kms.calls[0].auth, "Bearer tok-1");
    await assert.rejects(w.unwrap(wrapped, "user-2"), /KMS decrypt failed \(400\)/);
    await assert.rejects(w.unwrap(wrapped, "user-1", "team"));
    // The same bytes wrapped for a workspace open only as that workspace's.
    const teamWrapped = await w.wrap(data, "w-1", "team");
    assert.deepEqual(Buffer.from(await w.unwrap(teamWrapped, "w-1", "team")), key);
    await assert.rejects(w.unwrap(teamWrapped, "w-1"));
  } finally {
    await kms.close();
  }
});

test("the KMS wrapper caches unwrapped keys for 10 minutes and hands out copies", async () => {
  const kms = await fakeKms();
  try {
    let t = 1_000_000;
    const w = kmsWrapper({ keyName: KEY_NAME, token: async () => "t", endpoint: kms.url, now: () => t });
    const wrapped = await w.wrap(Uint8Array.from(randomBytes(32)), "u");
    const decrypts = () => kms.calls.filter((c) => c.path.endsWith(":decrypt")).length;
    const first = await w.unwrap(wrapped, "u");
    first.fill(0); // a caller zeroing its copy (the key service does) must not spoil the cache
    const second = await w.unwrap(wrapped, "u");
    assert.notDeepEqual(second, first);
    assert.equal(decrypts(), 1);
    t += 9 * 60_000;
    await w.unwrap(wrapped, "u");
    assert.equal(decrypts(), 1);
    t += 2 * 60_000;
    await w.unwrap(wrapped, "u");
    assert.equal(decrypts(), 2);
  } finally {
    await kms.close();
  }
});

test("a KMS error reports the status and nothing from the response", async () => {
  const stub = (async () => new Response(JSON.stringify({ error: { message: "secret-detail" } }), { status: 403 })) as typeof fetch;
  const w = kmsWrapper({ keyName: KEY_NAME, token: async () => "t", fetch: stub });
  await assert.rejects(w.wrap(new Uint8Array(32), "u"), (err: Error & { code?: string }) => err.code === "kms_403" && !err.message.includes("secret-detail") && err.message.includes("403"));
});

test("dataKeyFor writes with the first wrapper and reads by wrapped_by, so both kinds live side by side", async () => {
  const kms = await fakeKms();
  try {
    const local = await localWrapper(vectors.localWrap.masterKeyBase64);
    const remote = kmsWrapper({ keyName: KEY_NAME, token: async () => "t", endpoint: kms.url });
    const rows = new Map<string, { wrapped_key: string; wrapped_by: string }>();
    const store: KeyStore = {
      read: async (id) => rows.get(id) ?? null,
      insertIfAbsent: async (r) => { if (!rows.has(r.user_id)) rows.set(r.user_id, r); },
    };
    const oldKey = await dataKeyFor(store, [local], "old-user");
    assert.equal(rows.get("old-user")?.wrapped_by, "local:v1");
    const newKey = await dataKeyFor(store, [remote, local], "new-user");
    assert.equal(rows.get("new-user")?.wrapped_by, "kms:v1");
    // With both configured, each row opens by its own wrapper.
    assert.deepEqual(await dataKeyFor(store, [remote, local], "old-user"), oldKey);
    assert.deepEqual(await dataKeyFor(store, [remote, local], "new-user"), newKey);
    // A process without the KMS wrapper refuses the kms row rather than guessing.
    await assert.rejects(dataKeyFor(store, [local], "new-user"), /No key wrapper for kms:v1/);
  } finally {
    await kms.close();
  }
});

test("wrappersFromEnv puts KMS first when KMS_KEY_NAME is set, and needs one of the two", async () => {
  const both = await wrappersFromEnv({ KMS_KEY_NAME: KEY_NAME, KMS_ACCESS_TOKEN: "t", KEY_WRAPPING_KEY: vectors.localWrap.masterKeyBase64 });
  assert.deepEqual(both.map((w) => w.id), ["kms:v1", "local:v1"]);
  assert.deepEqual((await wrappersFromEnv({ KEY_WRAPPING_KEY: vectors.localWrap.masterKeyBase64 })).map((w) => w.id), ["local:v1"]);
  await assert.rejects(wrappersFromEnv({}), /KMS_KEY_NAME or KEY_WRAPPING_KEY/);
});

test("googleAccessToken reads the metadata server, and caches the token", async () => {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    assert.equal(req.headers["metadata-flavor"], "Google");
    res.end(JSON.stringify({ access_token: "meta-token", expires_in: 3599 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
    const token = googleAccessToken({ GCE_METADATA_HOST: host });
    assert.equal(await token(), "meta-token");
    assert.equal(await token(), "meta-token");
    assert.equal(hits, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("googleAccessToken signs a JWT for a service account key", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let assertion = "";
  const server = createServer(async (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      assertion = new URLSearchParams(body).get("assertion") ?? "";
      res.end(JSON.stringify({ access_token: "sa-token", expires_in: 3600 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const tokenUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/token`;
    const json = JSON.stringify({ client_email: "kms@messages-keys.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: tokenUri });
    assert.equal(await googleAccessToken({ GOOGLE_APPLICATION_CREDENTIALS_JSON: json })(), "sa-token");
    const [h, c, s] = assertion.split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    assert.equal(claims.iss, "kms@messages-keys.iam.gserviceaccount.com");
    assert.equal(claims.scope, "https://www.googleapis.com/auth/cloud-platform");
    assert.equal(JSON.parse(Buffer.from(h, "base64url").toString()).alg, "RS256");
    const { createVerify } = await import("node:crypto");
    assert.ok(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url")));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("credentials sealed under a user's key match the saved vector, and only open for their account", async () => {
  const dataKey = Uint8Array.from(Buffer.from(credVectors.dataKeyHex, "hex"));
  const key = await deriveCredentialKey(dataKey);
  assert.equal(Buffer.from(key).toString("hex"), credVectors.credentialKeyHex);
  assert.equal(await openCredential(key, credVectors.accountId, credVectors.sealed), credVectors.plaintext);
  assert.equal(await sealCredential(key, credVectors.accountId, credVectors.plaintext, Uint8Array.from(Buffer.from(credVectors.ivHex, "hex"))), credVectors.sealed);
  await assert.rejects(openCredential(key, "another-account", credVectors.sealed));
  await assert.rejects(openCredential(await deriveCredentialKey(Uint8Array.from({ length: 32 }, () => 9)), credVectors.accountId, credVectors.sealed));
  // A fresh seal is different each time and opens.
  const a = await sealCredential(key, "acc", "secret");
  assert.notEqual(a, await sealCredential(key, "acc", "secret"));
  assert.equal(await openCredential(key, "acc", a), "secret");
});

test("concurrent unwraps of one key make one KMS call, and a failure is not cached", async () => {
  let calls = 0;
  let fail = true;
  const stub = (async (_url: string, init?: RequestInit) => {
    calls++;
    assert.ok(init?.signal, "KMS calls carry a timeout signal");
    await new Promise((r) => setTimeout(r, 20));
    if (fail) return new Response("{}", { status: 503 });
    return new Response(JSON.stringify({ plaintext: Buffer.alloc(32, 7).toString("base64") }));
  }) as unknown as typeof fetch;
  const w = kmsWrapper({ keyName: KEY_NAME, token: async () => "t", fetch: stub });
  const failed = await Promise.allSettled([w.unwrap("w", "u"), w.unwrap("w", "u"), w.unwrap("w", "u")]);
  assert.ok(failed.every((r) => r.status === "rejected"));
  assert.equal(calls, 1);
  fail = false;
  const keys = await Promise.all([w.unwrap("w", "u"), w.unwrap("w", "u"), w.unwrap("w", "u")]);
  assert.equal(calls, 2);
  keys[0].fill(0); // each caller holds its own copy
  assert.equal(keys[1][0], 7);
});

test("concurrent token callers share one refresh", async () => {
  let hits = 0;
  const stub = (async () => { hits++; await new Promise((r) => setTimeout(r, 10)); return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 })); }) as unknown as typeof fetch;
  const token = googleAccessToken({ GCE_METADATA_HOST: "x" }, stub);
  assert.deepEqual(await Promise.all([token(), token(), token()]), ["tk", "tk", "tk"]);
  assert.equal(hits, 1);
});
