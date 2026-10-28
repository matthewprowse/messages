import { test } from "node:test";
import assert from "node:assert/strict";
import { bimiLogoUrl, commonsFileUrl, currentFiles, infoboxLogo, publisherMatches, simpleIconFor } from "./sources";

test("App Store apps count only when the company publishes them", () => {
  // Its publisher's site is on the domain, though the publisher's name is not the company's.
  assert.ok(publisherMatches({ trackName: "FNB Banking App", sellerName: "FirstRand Bank Limited", sellerUrl: "https://www.fnb.co.za/ways-to-bank/" }, "FNB", "fnb.co.za"));
  assert.ok(publisherMatches({ trackName: "Amazon - Shopping made easy", sellerName: "AMZN Mobile LLC", sellerUrl: "https://www.amazon.com/" }, "Amazon", "amazon.com"));
  // Named for the company, or its bundle ID starts with the domain backwards.
  assert.ok(publisherMatches({ trackName: "Makro Online Shopping", sellerName: "MAKRO S A (PTY) LTD" }, "Makro", "makro.co.za"));
  assert.ok(publisherMatches({ trackName: "Some App", sellerName: "Acme", bundleId: "za.co.capitecbank.app" }, "Capitec", "capitecbank.co.za"));
  // A product of a parent company, named on the parent's page for it.
  assert.ok(publisherMatches({ trackName: "Checkers Sixty60", sellerName: "Shoprite Checkers (PTY) LTD", sellerUrl: "http://www.checkers.co.za/sixty60" }, "Sixty60", "sixty60.co.za"));
  // Another publisher's app with the company's name, even on a lookalike site.
  assert.ok(!publisherMatches({ trackName: "Quicket", sellerName: "Omar Faruk Riyad", sellerUrl: "https://quicket.me/", bundleId: "com.quicket.app" }, "Quicket", "quicket.co.za"));
  assert.ok(!publisherMatches({ trackName: "WhatsApp Messenger", sellerName: "WhatsApp Inc.", sellerUrl: "http://www.whatsapp.com/" }, "FNB", "fnb.co.za"));
});

test("BIMI records name an HTTPS logo", () => {
  assert.equal(bimiLogoUrl([["v=BIMI1; l=https://example.com/logo.svg; a=https://example.com/vmc.pem"]]), "https://example.com/logo.svg");
  assert.equal(bimiLogoUrl([["v=spf1 include:_spf.example.com"], ["v=BIMI1;", " l=https://example.com/b.svg"]]), "https://example.com/b.svg");
  assert.equal(bimiLogoUrl([["v=BIMI1; l=http://example.com/logo.svg"]]), null);
  assert.equal(bimiLogoUrl([["v=BIMI1; l=;"]]), null);
  assert.equal(bimiLogoUrl([]), null);
});

test("Wikidata logos: current files first, old ones left out", () => {
  const claims = {
    P154: [
      { rank: "normal", mainsnak: { datavalue: { value: "Old Logo.svg" } }, qualifiers: { P582: [] } },
      { rank: "normal", mainsnak: { datavalue: { value: "Logo.svg" } } },
      { rank: "preferred", mainsnak: { datavalue: { value: "Logo 2026.svg" } } },
      { rank: "deprecated", mainsnak: { datavalue: { value: "Wrong.svg" } } },
    ],
  };
  assert.deepEqual(currentFiles(claims, "P154"), ["Logo 2026.svg", "Logo.svg"]);
  assert.deepEqual(currentFiles(claims, "P8972"), []);
  // Commons keeps a file under the MD5 of its name; an SVG is drawn as a 500px PNG.
  assert.equal(commonsFileUrl("Netflix 2015 logo.svg"), "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/500px-Netflix_2015_logo.svg.png");
  assert.match(commonsFileUrl("Logo.png"), /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/Logo\.png$/);
});

test("Simple Icons: the icon named for the company or its domain, never one merely kept on its site", () => {
  const icons = [
    { title: "Activeloop", slug: "activeloop", hex: "6888F5", source: "https://www.figma.com/file/abc" },
    { title: "Figma", slug: "figma", hex: "F24E1E", source: "https://www.figma.com/using-the-figma-brand/" },
    { title: "Booking.com", slug: "bookingdotcom", hex: "003580" },
  ];
  assert.equal(simpleIconFor(icons, "Figma", "figma.com")?.slug, "figma");
  assert.equal(simpleIconFor(icons, "Booking.com", "booking.com")?.slug, "bookingdotcom");
  assert.equal(simpleIconFor(icons, "Konva", "konva.app"), null);
});

test("the logo a Wikipedia infobox names", () => {
  assert.equal(infoboxLogo("{{Infobox company\n| name = Checkers\n| logo = Checkers (supermarket chain) Logo.svg\n| logo_size = 200px\n}}"), "Checkers (supermarket chain) Logo.svg");
  assert.equal(infoboxLogo("| logo = [[File:Acme logo.png|200px]]"), "Acme logo.png");
  assert.equal(infoboxLogo("| logo_size = 200px\n| image = Store.jpg"), null);
  assert.equal(infoboxLogo("| logo = {{Wikidata|logo}}"), null);
});
