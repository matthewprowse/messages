import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoconfigUrls, baseDomain, CPANEL, discover, fromPreset, guessServers, hostedElsewhere, ICLOUD, matchPreset, parseAutoconfig, PRESETS, readSettings,
  type Lookups,
} from "./index";

test("the iCloud preset is the servers the iCloud connector always used", () => {
  assert.deepEqual(ICLOUD.servers("icloud.com"), {
    imap: [{ host: "imap.mail.me.com", port: 993, tls: "tls" }],
    smtp: [{ host: "smtp.mail.me.com", port: 587, security: "starttls" }],
  });
});

test("presets match by the address's domain", () => {
  const id = (domain: string) => matchPreset(domain)?.preset.id;
  assert.equal(id("yahoo.com"), "yahoo");
  assert.equal(id("yahoo.co.uk"), "yahoo");
  assert.equal(id("ymail.com"), "yahoo");
  assert.equal(id("fastmail.com"), "fastmail");
  assert.equal(id("fastmail.fm"), "fastmail");
  assert.equal(id("zoho.com"), "zoho");
  assert.equal(id("zohomail.eu"), "zoho");
  assert.equal(id("gmx.com"), "gmx");
  assert.equal(id("gmx.de"), "gmx");
  assert.equal(id("example.co.za"), undefined);
});

test("presets match your own domain by its MX hosts, then its name servers", () => {
  assert.equal(matchPreset("firm.co.za", ["mx.zoho.eu", "mx2.zoho.eu"])?.preset.id, "zoho");
  assert.equal(matchPreset("firm.co.za", ["in1-smtp.messagingengine.com"])?.preset.id, "fastmail");
  assert.equal(matchPreset("firm.co.za", ["mta5.am0.yahoodns.net"])?.preset.id, "yahoo");
  assert.equal(matchPreset("firm.co.za", ["mx1.tld-mx.com", "mx2.tld-mx.net"])?.preset.id, "domains_co_za");
  assert.equal(matchPreset("firm.co.za", ["inbound.cpt.host-h.net"])?.preset.id, "xneelo");
  // Hosts whose customers' MX is mail.theirdomain are found by name server.
  assert.equal(matchPreset("firm.co.za", ["mail.firm.co.za"], ["ns1.host-h.net", "ns1.dns-h.com"])?.preset.id, "xneelo");
  assert.equal(matchPreset("firm.co.za", ["mail.firm.co.za"], ["ns.dns1.co.za", "ns.dns2.co.za"])?.preset.id, "afrihost");
  assert.equal(matchPreset("firm.co.za", ["mail.firm.co.za"], ["ns1.tld-ns.net"])?.preset.id, "domains_co_za");
  assert.equal(matchPreset("firm.co.za", ["mail.firm.co.za"], ["ns1.somehost.co.za"]), null);
});

test("each preset's servers follow the provider's published settings", () => {
  const servers = (id: string, domain: string, via?: string) => PRESETS.find((p) => p.id === id)!.servers(domain, via);
  assert.deepEqual(servers("yahoo", "yahoo.com"), {
    imap: [{ host: "imap.mail.yahoo.com", port: 993, tls: "tls" }],
    smtp: [{ host: "smtp.mail.yahoo.com", port: 465, security: "ssl" }, { host: "smtp.mail.yahoo.com", port: 587, security: "starttls" }],
  });
  assert.deepEqual(servers("fastmail", "fastmail.com"), {
    imap: [{ host: "imap.fastmail.com", port: 993, tls: "tls" }],
    smtp: [{ host: "smtp.fastmail.com", port: 465, security: "ssl" }, { host: "smtp.fastmail.com", port: 587, security: "starttls" }],
  });
  // A Zoho address uses imap and smtp; your own domain the pro servers, in its data centre.
  assert.deepEqual(servers("zoho", "zoho.com"), { imap: [{ host: "imap.zoho.com", port: 993, tls: "tls" }], smtp: [{ host: "smtp.zoho.com", port: 465, security: "ssl" }] });
  assert.deepEqual(servers("zoho", "firm.co.za", "mx.zoho.eu").imap.map((s) => s.host), ["imappro.zoho.eu", "imap.zoho.eu"]);
  assert.deepEqual(servers("zoho", "firm.co.za", "mx.zoho.com.au").smtp.map((s) => s.host), ["smtppro.zoho.com.au", "smtp.zoho.com.au"]);
  assert.deepEqual(servers("gmx", "gmx.com"), {
    imap: [{ host: "imap.gmx.com", port: 993, tls: "tls" }],
    smtp: [{ host: "mail.gmx.com", port: 587, security: "starttls" }, { host: "mail.gmx.com", port: 465, security: "ssl" }],
  });
  assert.equal(servers("gmx", "gmx.de").imap[0].host, "imap.gmx.net");
  assert.deepEqual(servers("afrihost", "firm.co.za"), {
    imap: [{ host: "mail.firm.co.za", port: 993, tls: "tls" }],
    smtp: [{ host: "mail.firm.co.za", port: 465, security: "ssl" }, { host: "mail.firm.co.za", port: 587, security: "starttls" }],
  });
  assert.deepEqual(servers("xneelo", "firm.co.za").imap, [{ host: "mail.firm.co.za", port: 993, tls: "tls" }]);
  assert.deepEqual(servers("xneelo", "firm.co.za").smtp[0], { host: "smtp.firm.co.za", port: 465, security: "ssl" });
  assert.deepEqual(servers("domains_co_za", "firm.co.za"), CPANEL.servers("firm.co.za"));
});

test("a preset becomes candidates signed in with the full address", () => {
  const c = fromPreset("thandi@yahoo.com", matchPreset("yahoo.com")!.preset);
  assert.equal(c.username, "thandi@yahoo.com");
  assert.equal(c.source, "preset");
  assert.equal(c.label, "Yahoo Mail");
  assert.match(c.hint ?? "", /app password/);
});

test("Google, Microsoft and iCloud addresses go to their own setup", () => {
  assert.equal(hostedElsewhere("gmail.com"), "google");
  assert.equal(hostedElsewhere("outlook.co.za"), "microsoft");
  assert.equal(hostedElsewhere("me.com"), "icloud");
  assert.equal(hostedElsewhere("firm.co.za", ["aspmx.l.google.com"]), "google");
  assert.equal(hostedElsewhere("firm.co.za", ["firm-co-za.mail.protection.outlook.com"]), "microsoft");
  assert.equal(hostedElsewhere("firm.co.za", ["mx01.mail.icloud.com"]), "icloud");
  assert.equal(hostedElsewhere("firm.co.za", ["mail.firm.co.za"]), null);
});

// What cPanel serves at autoconfig.<domain>: the server's own name, with POP3 as well.
const CPANEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="firm.co.za">
    <domain>firm.co.za</domain>
    <displayName>thandi@firm.co.za</displayName>
    <incomingServer type="pop3">
      <hostname>server12.hostco.co.za</hostname>
      <port>995</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>thandi@firm.co.za</username>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>server12.hostco.co.za</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>thandi@firm.co.za</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>server12.hostco.co.za</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>thandi@firm.co.za</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

// The ISPDB style: placeholders, an unencrypted fallback, an OAuth-only server and an odd port.
const ISPDB_XML = `<clientConfig version="1.1">
  <emailProvider id="example.net">
    <incomingServer type="imap">
      <hostname>oauth.%EMAILDOMAIN%</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <authentication>OAuth2</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.%EMAILDOMAIN%</hostname>
      <port>143</port>
      <socketType>STARTTLS</socketType>
      <authentication>OAuth2</authentication>
      <authentication>password-encrypted</authentication>
      <username>%EMAILLOCALPART%</username>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.%EMAILDOMAIN%</hostname>
      <port>143</port>
      <socketType>plain</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILLOCALPART%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.%EMAILDOMAIN%</hostname>
      <port>26</port>
      <socketType>STARTTLS</socketType>
      <username>%EMAILLOCALPART%</username>
    </outgoingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.%EMAILDOMAIN%</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILLOCALPART%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

test("an autoconfig file gives its IMAP and SMTP servers, POP3 left out", () => {
  assert.deepEqual(parseAutoconfig(CPANEL_XML, "thandi@firm.co.za"), {
    imap: [{ host: "server12.hostco.co.za", port: 993, tls: "tls" }],
    smtp: [{ host: "server12.hostco.co.za", port: 465, security: "ssl" }],
    username: "thandi@firm.co.za",
  });
});

test("autoconfig placeholders are filled; OAuth-only, unencrypted and odd-port servers are left out", () => {
  assert.deepEqual(parseAutoconfig(ISPDB_XML, "sipho@example.net"), {
    imap: [{ host: "imap.example.net", port: 143, tls: "starttls" }],
    smtp: [{ host: "smtp.example.net", port: 587, security: "starttls" }],
    username: "sipho",
  });
});

test("an autoconfig file without usable IMAP or SMTP gives nothing", () => {
  assert.equal(parseAutoconfig("<html>Not found</html>", "a@b.co.za"), null);
  assert.equal(parseAutoconfig(CPANEL_XML.replace(/<outgoingServer[\s\S]*<\/outgoingServer>/, ""), "a@firm.co.za"), null);
  assert.equal(parseAutoconfig(CPANEL_XML.replace("server12.hostco.co.za</hostname>\n      <port>993", "10.0.0.5</hostname>\n      <port>993"), "a@firm.co.za"), null);
});

test("autoconfig is looked for at the domain's own addresses, then Mozilla's ISPDB", () => {
  assert.deepEqual(autoconfigUrls("firm.co.za"), [
    "https://autoconfig.firm.co.za/mail/config-v1.1.xml",
    "https://firm.co.za/.well-known/autoconfig/mail/config-v1.1.xml",
    "https://autoconfig.thunderbird.net/v1.1/firm.co.za",
  ]);
});

test("the MX guess tries mail.yourdomain first, then imap., smtp. and the MX host", () => {
  assert.deepEqual(guessServers("firm.co.za", ["server12.hostco.co.za"]), {
    imap: [
      { host: "mail.firm.co.za", port: 993, tls: "tls" },
      { host: "imap.firm.co.za", port: 993, tls: "tls" },
      { host: "server12.hostco.co.za", port: 993, tls: "tls" },
    ],
    smtp: [
      { host: "mail.firm.co.za", port: 465, security: "ssl" },
      { host: "mail.firm.co.za", port: 587, security: "starttls" },
      { host: "smtp.firm.co.za", port: 465, security: "ssl" },
      { host: "server12.hostco.co.za", port: 465, security: "ssl" },
    ],
  });
  // An MX of mail.yourdomain is not tried twice.
  assert.deepEqual(guessServers("firm.co.za", ["mail.firm.co.za"]).imap.map((s) => s.host), ["mail.firm.co.za", "imap.firm.co.za"]);
});

test("base domains keep a country's second level", () => {
  assert.equal(baseDomain("mail.firm.co.za"), "firm.co.za");
  assert.equal(baseDomain("mx1.tld-mx.com"), "tld-mx.com");
  assert.equal(baseDomain("mx.zoho.com.au"), "zoho.com.au");
});

function fakeLookups(dns: { mx?: string[]; ns?: string[] }, files: Record<string, string> = {}) {
  const asked: string[] = [];
  const lookups: Lookups = {
    mx: async () => dns.mx ?? [],
    ns: async () => dns.ns ?? [],
    text: async (url) => {
      asked.push(url);
      return files[url] ?? null;
    },
  };
  return { lookups, asked };
}

test("discover: a provider's own domain needs no lookups", async () => {
  const { lookups, asked } = fakeLookups({ mx: ["ignored.example"] });
  const found = await discover("thandi@fastmail.com", lookups);
  assert.ok("imap" in found);
  assert.equal(found.label, "Fastmail");
  assert.equal(asked.length, 0);
});

test("discover: Google and Microsoft domains are sent to their own setup", async () => {
  assert.deepEqual(await discover("a@gmail.com", fakeLookups({}).lookups), { elsewhere: "google" });
  assert.deepEqual(await discover("a@firm.co.za", fakeLookups({ mx: ["aspmx.l.google.com"] }).lookups), { elsewhere: "google" });
});

test("discover: a hosted domain matches its host's preset before any file is fetched", async () => {
  const { lookups, asked } = fakeLookups({ mx: ["mail.firm.co.za"], ns: ["ns1.host-h.net"] });
  const found = await discover("thandi@firm.co.za", lookups);
  assert.ok("imap" in found);
  assert.equal(found.label, "xneelo Mail");
  assert.equal(asked.length, 0);
});

test("discover: the domain's own autoconfig file comes before the ISPDB", async () => {
  const { lookups, asked } = fakeLookups(
    { mx: ["mx.hostco.co.za"] },
    {
      "https://autoconfig.firm.co.za/mail/config-v1.1.xml": CPANEL_XML,
      "https://autoconfig.thunderbird.net/v1.1/firm.co.za": ISPDB_XML,
    },
  );
  const found = await discover("thandi@firm.co.za", lookups);
  assert.ok("imap" in found);
  assert.equal(found.source, "autoconfig");
  assert.equal(found.imap[0].host, "server12.hostco.co.za");
  // The ISPDB is asked for the mail host's domain as well.
  assert.ok(asked.includes("https://autoconfig.thunderbird.net/v1.1/hostco.co.za"));
});

test("discover: with no preset and no file, the MX guess", async () => {
  const found = await discover("thandi@firm.co.za", fakeLookups({ mx: ["server12.hostco.co.za"] }).lookups);
  assert.ok("imap" in found);
  assert.equal(found.source, "guess");
  assert.equal(found.imap[0].host, "mail.firm.co.za");
  assert.equal(found.username, "thandi@firm.co.za");
});

test("discover: failing lookups still end in a guess", async () => {
  const failing: Lookups = { mx: async () => { throw new Error("dns"); }, ns: async () => { throw new Error("dns"); }, text: async () => { throw new Error("http"); } };
  const found = await discover("thandi@firm.co.za", failing);
  assert.ok("imap" in found);
  assert.equal(found.source, "guess");
});

test("typed settings are tidied, and only encrypted connections on the usual ports pass", () => {
  const good = { imap: { host: " Mail.Firm.co.za ", port: "993", tls: "tls" }, smtp: { host: "mail.firm.co.za", port: 587, security: "starttls" }, username: " thandi@firm.co.za " };
  assert.deepEqual(readSettings(good), {
    imap: { host: "mail.firm.co.za", port: 993, tls: "tls" },
    smtp: { host: "mail.firm.co.za", port: 587, security: "starttls" },
    username: "thandi@firm.co.za",
  });
  assert.ok("error" in readSettings({ ...good, imap: { ...good.imap, host: "127.0.0.1" } }));
  assert.ok("error" in readSettings({ ...good, imap: { ...good.imap, port: 22 } }));
  assert.ok("error" in readSettings({ ...good, smtp: { ...good.smtp, security: "none" } }));
  assert.ok("error" in readSettings({ ...good, username: "" }));
  assert.ok("error" in readSettings(null));
});
