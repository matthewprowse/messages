// Tests for onedrive-protocol.ts: the sign-in address, the token request, and how the picker's messages are read.

import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeUrl, base64Url, GRAPH_FILES_SCOPE, pickerOptions, readPickerMessage, scopeFor, tokenBody } from "./onedrive-protocol";

test("PKCE text is URL safe with no padding", () => {
  assert.equal(base64Url(new Uint8Array([251, 255, 254])), "-__-");
  assert.equal(base64Url(new Uint8Array([1])), "AQ");
});

test("the sign-in address asks for one scope with a challenge and state", () => {
  const u = new URL(authorizeUrl({ clientId: "c1", redirectUri: "https://app/cb", scope: GRAPH_FILES_SCOPE, state: "s", challenge: "ch" }));
  assert.equal(u.searchParams.get("scope"), GRAPH_FILES_SCOPE);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("state"), "s");
});

test("the token request carries the verifier and no secret", () => {
  const body = tokenBody({ clientId: "c1", redirectUri: "r", scope: "s", code: "x", verifier: "v" });
  assert.equal(body.get("code_verifier"), "v");
  assert.equal(body.get("client_secret"), null);
});

test("the picker's own resource gets its .default scope, anything else Graph", () => {
  assert.equal(scopeFor({ type: "SharePoint", resource: "https://acme-my.sharepoint.com/" }), "https://acme-my.sharepoint.com/.default");
  assert.equal(scopeFor({ type: "Graph" }), GRAPH_FILES_SCOPE);
  assert.equal(scopeFor({}), GRAPH_FILES_SCOPE);
});

test("the picker opens for files only, with the page's origin on the channel", () => {
  const o = pickerOptions("https://app", "ch");
  assert.equal(o.typesAndSources.mode, "files");
  assert.deepEqual(o.messaging, { origin: "https://app", channelId: "ch" });
});

test("picker messages are read into the few the app acts on", () => {
  assert.deepEqual(readPickerMessage({ type: "notification", data: { notification: "page-loaded" } }), { kind: "page-loaded" });
  assert.deepEqual(readPickerMessage({ type: "command", id: "1", data: { command: "authenticate", type: "Graph" } }), { kind: "authenticate", id: "1", scope: GRAPH_FILES_SCOPE });
  assert.deepEqual(readPickerMessage({ type: "command", id: "2", data: { command: "pick", items: [{ id: "a" }] } }), { kind: "pick", id: "2", items: [{ id: "a" }] });
  assert.deepEqual(readPickerMessage({ type: "command", id: "3", data: { command: "close" } }), { kind: "close", id: "3" });
  assert.deepEqual(readPickerMessage({ type: "command", data: { command: "pick" } }), { kind: "other" });
  assert.deepEqual(readPickerMessage(null), { kind: "other" });
});
