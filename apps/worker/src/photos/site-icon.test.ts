import { test } from "node:test";
import assert from "node:assert/strict";
import { imageType, isPublicAddress, manifestIcons, pageIcons, pageLogos } from "./site-icon";

test("only public addresses are fetched", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "nonsense"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "151.101.1.69", "2606:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("a page's icons: apple-touch-icon first, then SVG, then the largest; small ones and mask icons left out", () => {
  const html = `<head>
    <link rel="icon" href="/favicon-16.png" sizes="16x16">
    <link rel="icon" type="image/svg+xml" href="/icon-svg">
    <link rel='shortcut icon' href='https://cdn.example.com/f96.png' sizes='96x96'>
    <link rel="icon" href="/favicon.ico">
    <link rel="mask-icon" href="/pinned.svg" color="#000">
    <link rel="apple-touch-icon" href="touch.png?v=2&amp;x=1">
    <link rel="manifest" href="/site.webmanifest">
    <link rel="stylesheet" href="/site.css">
  </head>`;
  const { icons, manifest } = pageIcons(html, new URL("https://www.example.com/en/"));
  assert.deepEqual(
    icons.map((i) => [i.kind, i.href]),
    [
      ["touch", "https://www.example.com/en/touch.png?v=2&x=1"],
      ["svg", "https://www.example.com/icon-svg"],
      ["icon", "https://cdn.example.com/f96.png"],
      ["icon", "https://www.example.com/favicon.ico"],
    ],
  );
  assert.equal(manifest, "https://www.example.com/site.webmanifest");
});

test("a manifest's icons, largest first, without small or monochrome ones", () => {
  const json = JSON.stringify({
    icons: [
      { src: "/i-48.png", sizes: "48x48" },
      { src: "/i-192.png", sizes: "192x192" },
      { src: "i-512.png", sizes: "512x512", purpose: "any maskable" },
      { src: "/mono.png", sizes: "512x512", purpose: "monochrome" },
    ],
  });
  assert.deepEqual(
    manifestIcons(json, new URL("https://example.com/app/manifest.json")).map((i) => [i.href, i.size]),
    [
      ["https://example.com/app/i-512.png", 512],
      ["https://example.com/i-192.png", 192],
    ],
  );
  assert.deepEqual(manifestIcons("not json", new URL("https://example.com/")), []);
});

test("photo types from their bytes", () => {
  assert.equal(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(imageType(Buffer.from("<svg xmlns=...>")), null);
  assert.equal(imageType(Buffer.from("<!doctype html>")), null);
});

test("a page's logo images: up to two that say they are a logo, then its preview image over https, never inline data", () => {
  const html = `<header><img src="data:image/svg+xml;base64,AAAA" class="logo"><img src="/img/hero.jpg" alt="Our team">
    <img class="site-logo" src="/assets/brand.png?v=2&amp;x=1"><img alt="Acme logo" data-src="https://cdn.acme.com/acme.svg">
    <img id="logo-footer" src="/footer-logo.png"></header>`;
  const head = `<meta property="og:image" content="http://acme.com/share.png" />`;
  assert.deepEqual(
    pageLogos(head + html, new URL("https://acme.com/")).map((l) => [l.href, l.kind]),
    [["https://acme.com/assets/brand.png?v=2&x=1", "logo"], ["https://cdn.acme.com/acme.svg", "logo"], ["https://acme.com/share.png", "logo"]],
  );
});
