// Tests for people.ts: recognising role addresses and company senders, keeping real people as people, and when a company
// logo stands in for a sender.

import assert from "node:assert/strict";
import { test } from "node:test";
import { companyLogo, isCompanySender, isRoleAddress } from "./people";

const contact = (name: string, emails: string[], organizationName: string | null, phones: string[] = []) => ({ name, emails, phones, organizationName });

test("recognises role addresses", () => {
  for (const a of ["noreply@emirates.com", "no-reply@x.com", "do-not-reply@x.com", "info@checkers.co.za", "news@x.com", "support+tickets@x.com", "noreply-alerts@x.com"]) {
    assert.equal(isRoleAddress(a), true, a);
  }
  for (const a of ["geoff.prowse@x.com", "julia@x.com", "andrew@relocationafrica.co.za"]) assert.equal(isRoleAddress(a), false, a);
});

test("brands and role senders are companies", () => {
  assert.equal(isCompanySender(contact("Emirates", ["deals@e.emirates.com"], "Emirates")), true);
  assert.equal(isCompanySender(contact("Emirates Skywards", ["skywards@emirates.com"], "Emirates")), true);
  assert.equal(isCompanySender(contact("Checkers", ["hello@checkers.co.za"], "Checkers")), true);
  assert.equal(isCompanySender(contact("Kate at Notion", ["noreply@notion.so"], "Notion")), true);
  assert.equal(isCompanySender(contact("The Browser Company", ["members@thebrowser.company"], "Thebrowser")), true);
  assert.equal(isCompanySender(contact("Takealot Support", ["help@takealot.com"], "Takealot")), true);
  assert.equal(isCompanySender(contact("Nicholas van Schalkwyk via LinkedIn", ["invitations@linkedin.com"], "LinkedIn")), true);
  assert.equal(isCompanySender(contact("Geordin Hill-Lewis on LinkedIn", ["notifications-noreply@linkedin.com"], "Linkedin")), true);
  assert.equal(isCompanySender(contact("Max Bishop via Google Docs", ["drive-shares@google.com"], "Google")), true);
  assert.equal(isCompanySender(contact("Don on Hill via Slack", ["notification@slack.com"], "Slack")), true);
  assert.equal(isCompanySender(contact("Adam from UX Pilot", ["adam@uxpilot.ai"], "Uxpilot")), true);
  assert.equal(isCompanySender(contact("Capitec Jobnotification", ["capitec@jobs2web.com"], "Jobs2web")), true);
  assert.equal(isCompanySender(contact("Information", ["office@walkerphillip.co.za"], "Walkerphillip")), true);
  assert.equal(isCompanySender(contact("Stellenbosch University Admissions", ["sun@hyperiondev.com"], "Hyperiondev")), true);
  assert.equal(isCompanySender(contact("Customerenquiries", ["customerenquiries@cottonon.com"], "Cottonon")), true);
  assert.equal(isCompanySender(contact("Mail Delivery Subsystem", ["mailer-daemon@googlemail.com"], null)), true);
});

test("people stay people", () => {
  assert.equal(isCompanySender(contact("Andrew Stegmann | Relocation Africa", ["andrew@relocationafrica.co.za"], "Relocationafrica")), false);
  assert.equal(isCompanySender(contact("Julia Randall", ["rndjul006@myuct.ac.za"], "Myuct")), false);
  assert.equal(isCompanySender(contact("Sarah at Home", ["sarah@acme.com"], "Acme")), false);
  assert.equal(isCompanySender(contact("Christopher", ["chris.smith@acme.com"], "Acme")), false);
  // A name that ends in some other company is no sign of this one.
  assert.equal(isCompanySender(contact("Max Bishop via Slack", ["max@acme.com"], "Acme")), false);
  assert.equal(isCompanySender(contact("Sam on Holiday", ["sam@acme.com"], "Acme")), false);
  // Anyone with a phone number is a person, even from a role address.
  assert.equal(isCompanySender(contact("Emirates", ["info@emirates.com"], "Emirates", ["+27821234567"])), false);
  // Senders not filed under a company stay in People, so they are not lost, except mail system senders.
  assert.equal(isCompanySender(contact("Info", ["info@gmail.com"], null)), false);
  assert.equal(isCompanySender(contact("Newsletter", ["noreply@gmail.com"], null)), true);
});

test("a company's logo stands in only for senders that write as that company", () => {
  const logo = "user/org-1";
  assert.equal(companyLogo(contact("LinkedIn", ["messages-noreply@linkedin.com"], "LinkedIn"), logo), logo);
  assert.equal(companyLogo(contact("Geordin Hill-Lewis on LinkedIn", ["notifications-noreply@linkedin.com"], "LinkedIn"), logo), logo);
  assert.equal(companyLogo(contact("Nicholas van Schalkwyk via LinkedIn", ["invitations@linkedin.com"], "LinkedIn"), logo), logo);
  assert.equal(companyLogo(contact("Max Bishop via Google Docs", ["drive-shares@google.com"], "Google"), logo), logo);
  assert.equal(companyLogo(contact("Dan from Relume", ["hello@relume.io"], "Relume"), logo), logo);
  assert.equal(companyLogo(contact("Workable", ["noreply@candidates.workablemail.com"], "Workablemail"), logo), logo);
  // Mail sent through a hiring or mailing service is not that service's.
  assert.equal(companyLogo(contact("Capitec Jobnotification", ["capitec@jobs2web.com"], "Jobs2web"), logo), undefined);
  assert.equal(companyLogo(contact("Advance Guidance", ["notifications@app.bamboohr.com"], "Bamboohr"), logo), undefined);
  // People keep their own (or no) photo, and there is nothing to show without a logo.
  assert.equal(companyLogo(contact("Andrew Stegmann", ["andrew@relocationafrica.com"], "Relocation Africa"), logo), undefined);
  assert.equal(companyLogo(contact("LinkedIn", ["messages-noreply@linkedin.com"], "LinkedIn"), null), undefined);
});
