import assert from "node:assert/strict";
import test from "node:test";
import { companyDomain, companyNameFor, companyNameForDomain, isPersonalMailDomain, mailDomainRoot, senderName, viaCompany } from "./company";

// Each case was checked against the SQL functions these replace (mail_domain_root, is_personal_mail_domain,
// organization_name_for_domain), which gave the same answers.
test("mail comes from the registrable domain", () => {
  for (const [domain, root] of [
    ["accountprotection.microsoft.com", "microsoft.com"],
    ["checkers.sixty60.co.za", "sixty60.co.za"],
    ["a.b.co.za", "b.co.za"],
    ["pedalpower.org.za", "pedalpower.org.za"],
    ["capetown.gov.za", "capetown.gov.za"],
    ["za.usn.global", "usn.global"],
    ["cottonon.zendesk.com", "cottonon.zendesk.com"],
    ["x.y.zendesk.com", "y.zendesk.com"],
    ["A.B.C.D.E", "d.e"],
    [".weird.", "weird"],
    ["localhost", "localhost"],
  ] as const) assert.equal(mailDomainRoot(domain), root, domain);
  assert.equal(mailDomainRoot(""), null);
});

test("personal mail providers are not companies", () => {
  for (const d of ["gmail.com", "icloud.com", "googlemail.com", "hotmail.co.uk", "yahoo.co.za", "outlook.co.za"]) assert.ok(isPersonalMailDomain(d), d);
  for (const d of ["microsoft.com", "mweb.co.za", "global.ntt"]) assert.ok(!isPersonalMailDomain(d), d);
});

test("a company is named from its domain's main label", () => {
  for (const [domain, name] of [
    ["big-talent.co.za", "Big Talent"],
    ["foo_bar.io", "Foo Bar"],
    ["3m.com", "3m"],
    ["formula1.com", "Formula1"],
    ["greenhouse-mail.io", "Greenhouse Mail"],
    ["o'neil.com", "O'neil"],
  ] as const) assert.equal(companyNameForDomain(domain), name, domain);
});

test("an address's company leaves out personal mail and your own domains", () => {
  const own = ["me@prowse.co.za", "+27824160503", "matt@icloud.com"];
  assert.equal(companyDomain("Sam@News.Pinterest.com", own), "pinterest.com");
  assert.equal(companyDomain("dad@gmail.com", own), null);
  assert.equal(companyDomain("colleague@mail.prowse.co.za", own), null);
  assert.equal(companyDomain("root@localhost", own), null);
  assert.equal(companyDomain("not an address", own), null);
});

test("company names keep the company's own spelling when the sender uses it", () => {
  assert.equal(companyNameFor("linkedin.com", "LinkedIn"), "LinkedIn");
  assert.equal(companyNameFor("primevideo.com", "Prime Video"), "Prime Video");
  assert.equal(companyNameFor("linkedin.com", "Geordin Hill-Lewis on LinkedIn"), "LinkedIn");
  assert.equal(companyNameFor("linkedin.com", "Nicholas van Schalkwyk via LinkedIn"), "LinkedIn");
  assert.equal(companyNameFor("linkedin.com", "Sam Jones on Facebook"), "Linkedin");
  assert.equal(companyNameFor("amazon.jobs", null), "Amazon");
});

test("automated senders are named for their company", () => {
  const fromAddress = (a: string) => a.split("@")[0];
  for (const [address, name] of [
    ["noreply@mail.amazon.jobs", null],
    ["noreply@mail.amazon.jobs", "Noreply"],
    ["no-reply@e.odigeo.com", "No Reply"],
    ["reply-kyyumtpgzjyu5bzrgizcgrgddm.70262@e.odigeo.com", "no-reply"],
    ["noreplycapetownnewlands@emeris.ac.za", "Noreplycapetownnewlands"],
    ["donotreply@upwork.com", "Do Not Reply"],
    ["info@aainform.co.za", "info@aainform.co.za"],
  ] as const) assert.equal(senderName(address, name, "Company", fromAddress), "Company", `${address} ${name}`);
  // Real names stay, and so do names the company chose for itself.
  assert.equal(senderName("noreply@amazon.com", "Amazon.co.za", "Amazon", fromAddress), "Amazon.co.za");
  assert.equal(senderName("no-reply@investec.co.za", "Payment", "Investec", fromAddress), "Payment");
  assert.equal(senderName("sarah@acme.com", "Sarah Okafor", "Acme", fromAddress), "Sarah Okafor");
  assert.equal(senderName("hello@smous.online", "Sarah From Smous", "Smous", fromAddress), "Sarah From Smous");
  assert.equal(senderName("team@m.ngrok.com", "Joel @ ngrok", "Ngrok", fromAddress), "Joel @ ngrok");
  assert.equal(senderName("capitec-jobnotification@noreply12.jobs2web.com", "Capitec Jobnotification", "Jobs2web", fromAddress), "Capitec Jobnotification");
  // No company (a personal or your own domain): the name, or one made from the address.
  assert.equal(senderName("noreply@prowse.co.za", null, null, fromAddress), "noreply");
  assert.equal(senderName("sarah.okafor@gmail.com", "", null, fromAddress), "sarah.okafor");
});

test("a name shared by everyone a service writes about is the company's", () => {
  const fromAddress = (a: string) => a.split("@")[0];
  assert.equal(viaCompany("Nicholas van Schalkwyk via LinkedIn"), "LinkedIn");
  assert.equal(viaCompany("Geordin Hill-Lewis on LinkedIn"), "LinkedIn");
  assert.equal(viaCompany("Max Bishop via Google Docs"), "Google Docs");
  assert.equal(viaCompany("LinkedIn"), null);
  assert.equal(viaCompany("Andrew Stegmann | Relocation Africa"), null);
  assert.equal(viaCompany(null), null);
  assert.equal(senderName("invitations@linkedin.com", "Nicholas van Schalkwyk via LinkedIn", "LinkedIn", fromAddress), "LinkedIn");
  assert.equal(senderName("notifications-noreply@linkedin.com", "Geordin Hill-Lewis on LinkedIn", "LinkedIn", fromAddress), "LinkedIn");
  assert.equal(senderName("drive-shares@google.com", "Max Bishop via Google Docs", "Google", fromAddress), "Google");
  assert.equal(senderName("notification@slack.com", "Priya Naidoo via Slack", "Slack", fromAddress), "Slack");
  // Only when the name ends in the sender's own company, and never without a company on file.
  assert.equal(senderName("max@acme.com", "Max Bishop via LinkedIn", "Acme", fromAddress), "Max Bishop via LinkedIn");
  assert.equal(senderName("max@gmail.com", "Max Bishop via LinkedIn", null, fromAddress), "Max Bishop via LinkedIn");
});
