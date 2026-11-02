// Tests for pick-map.ts and config.ts: how picker results become downloads, the size checks made before downloading, and
// which sources the Attach menu offers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadProblem, mapGoogleDoc, mapOneDriveItem, oneDrivePickerBase, partitionPicks, precheckPicks, type CloudPick } from "./pick-map";
import { availableSources, cloudConfigFrom } from "./config";

const MB = 1024 * 1024;
const pick = (name: string, size: number | null): CloudPick => ({ source: "google", name, size, mimeType: "application/pdf", url: "https://x" });

test("a Google Doc is exported as Word and gains its extension once", () => {
  const p = mapGoogleDoc({ id: "a b", name: "Quote", mimeType: "application/vnd.google-apps.document" }) as CloudPick;
  assert.equal(p.name, "Quote.docx");
  assert.equal(p.size, null);
  assert.match(p.url, /\/files\/a%20b\/export\?mimeType=/);
  assert.equal((mapGoogleDoc({ id: "1", name: "Quote.docx", mimeType: "application/vnd.google-apps.document" }) as CloudPick).name, "Quote.docx");
});

test("a stored Google Drive file downloads as media with its reported size and type", () => {
  const p = mapGoogleDoc({ id: "f1", name: "Invoice.pdf", mimeType: "application/pdf", sizeBytes: "2048" }) as CloudPick;
  assert.equal(p.size, 2048);
  assert.equal(p.mimeType, "application/pdf");
  assert.match(p.url, /\/files\/f1\?alt=media/);
});

test("Google items that are not files are refused with a message", () => {
  const r = mapGoogleDoc({ id: "f", name: "Form", mimeType: "application/vnd.google-apps.form" });
  assert.ok("error" in r && r.error.includes("Form"));
});

test("a OneDrive item downloads from its own drive; a folder is refused", () => {
  const p = mapOneDriveItem({ id: "i1", name: "Plan.xlsx", size: 99, file: { mimeType: "" }, parentReference: { driveId: "b!x" } }) as CloudPick;
  assert.equal(p.url, "https://graph.microsoft.com/v1.0/drives/b!x/items/i1/content");
  assert.equal(p.mimeType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.ok("error" in mapOneDriveItem({ id: "d", name: "Folder", folder: {}, parentReference: { driveId: "b" } }));
});

test("partitionPicks keeps downloads and messages apart", () => {
  const out = partitionPicks([pick("a", 1), { error: "no" }]);
  assert.equal(out.picks.length, 1);
  assert.deepEqual(out.errors, ["no"]);
});

test("a WhatsApp pick over 50 MB is refused before downloading; unknown sizes pass", () => {
  const rule = { provider: "whatsapp" as const, existing: [] };
  assert.ok(precheckPicks([pick("big.mp4", 51 * MB)], rule));
  assert.equal(precheckPicks([pick("doc", null)], rule), null);
  assert.equal(precheckPicks([pick("ok.pdf", 5 * MB)], rule), null);
});

test("email limits count files already attached", () => {
  const rule = { provider: "gmail" as const, existing: [{ name: "a.pdf", size: 15 * MB }] };
  assert.ok(precheckPicks([pick("b.pdf", 15 * MB)], rule));
  assert.equal(precheckPicks([pick("b.pdf", 1 * MB)], rule), null);
});

test("a note file over its cap is refused", () => {
  assert.ok(precheckPicks([pick("x", 60 * MB)], { maxBytes: 50 * MB })?.includes("50 MB"));
  assert.equal(precheckPicks([pick("x", 10 * MB)], { maxBytes: 50 * MB }), null);
});

test("download problems say what to do", () => {
  assert.match(downloadProblem({ name: "a.pdf", source: "onedrive" }, 401), /OneDrive again/);
  assert.match(downloadProblem({ name: "a.docx", source: "google" }, 403), /10 MB/);
  assert.match(downloadProblem({ name: "a.pdf", source: "google" }, 500), /did not download/);
});

test("OneDrive's picker address follows the account type", () => {
  assert.equal(oneDrivePickerBase("personal", "https://1drv.ms/x"), "https://onedrive.live.com/picker");
  assert.equal(oneDrivePickerBase("business", "https://acme-my.sharepoint.com/personal/a/Documents"), "https://acme-my.sharepoint.com/_layouts/15/FilePicker.aspx");
  assert.equal(oneDrivePickerBase("business", "not a url"), "https://onedrive.live.com/picker");
});

test("a source is offered only when all its keys are set", () => {
  assert.deepEqual(availableSources(cloudConfigFrom({})), []);
  assert.deepEqual(availableSources(cloudConfigFrom({ NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID: "c", NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: "k" })), []);
  assert.deepEqual(availableSources(cloudConfigFrom({ NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID: "c", NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: "k", NEXT_PUBLIC_GOOGLE_PICKER_APP_ID: "1", NEXT_PUBLIC_MICROSOFT_CLIENT_ID: " m " })), ["google", "onedrive"]);
});
