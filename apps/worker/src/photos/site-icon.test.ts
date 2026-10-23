import { test } from "node:test";
import assert from "node:assert/strict";
import { iconCandidates, iconType, isPublicAddress } from "./site-icon";

test("only public addresses are fetched", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "nonsense"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "151.101.1.69", "2606:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("apple-touch-icon first, then the largest icon; SVG skipped; addresses resolved against the page", () => {
  const html = `<head>
    <link rel="icon" href="/favicon-16.png" sizes="16x16">
    <link rel="icon" type="image/svg+xml" href="/icon.svg">
    <link rel='shortcut icon' href='https://cdn.example.com/f32.png' sizes='32x32'>
    <link rel="apple-touch-icon" href="touch.png?v=2&amp;x=1">
    <link rel="stylesheet" href="/site.css">
  </head>`;
  assert.deepEqual(iconCandidates(html, new URL("https://www.example.com/en/")), [
    "https://www.example.com/en/touch.png?v=2&x=1",
    "https://cdn.example.com/f32.png",
    "https://www.example.com/favicon-16.png",
  ]);
});

test("icon types from their bytes", () => {
  assert.equal(iconType(Buffer.from([0, 0, 1, 0, 1, 0])), "image/x-icon");
  assert.equal(iconType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(iconType(Buffer.from("<svg xmlns=...>")), null);
  assert.equal(iconType(Buffer.from("<!doctype html>")), null);
});
