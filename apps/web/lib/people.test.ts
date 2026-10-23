import assert from "node:assert/strict";
import { test } from "node:test";
import { isCompanySender, isRoleAddress } from "./people";

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
  // A real person writing through LinkedIn stays a person.
  assert.equal(isCompanySender(contact("Nicholas van Schalkwyk via LinkedIn", ["messages-noreply@linkedin.com"], "Linkedin")), false);
  // Anyone with a phone number is a person, even from a role address.
  assert.equal(isCompanySender(contact("Emirates", ["info@emirates.com"], "Emirates", ["+27821234567"])), false);
  // Senders not filed under a company stay in People, so they are not lost, except mail system senders.
  assert.equal(isCompanySender(contact("Info", ["info@gmail.com"], null)), false);
  assert.equal(isCompanySender(contact("Newsletter", ["noreply@gmail.com"], null)), true);
});
