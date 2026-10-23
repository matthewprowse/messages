import assert from "node:assert/strict";
import test from "node:test";
import { companyDomain, companyNameForDomain, isPersonalMailDomain, mailDomainRoot } from "./company";

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
