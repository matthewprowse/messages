import { test } from "node:test";
import assert from "node:assert/strict";
import { BAD_RECIPIENTS, FROM_NOT_ALLOWED, chooseFrom, cleanRecipients, fromCandidates, isEmailAddress, outgoingRecipients, replyToChosen, replyToParticipants } from "./from-address";

const account = { accountAddress: "matthew@prowse.co.za", sendAddresses: ["matthew@prowse.co.za", "hello@prowse.co.za", "m@icloud.com"] };

test("a chosen From is used when the account can send from it", () => {
  assert.deepEqual(chooseFrom({ ...account, requested: " Hello@Prowse.co.za ", inboundTo: [] }), { address: "hello@prowse.co.za" });
  assert.deepEqual(chooseFrom({ ...account, sendAddresses: [], requested: "matthew@prowse.co.za", inboundTo: [] }), {
    address: "matthew@prowse.co.za",
  });
});

test("a chosen From the account cannot send from fails", () => {
  assert.deepEqual(chooseFrom({ ...account, requested: "boss@company.com", inboundTo: [] }), { error: FROM_NOT_ALLOWED });
});

test("a reply defaults to the address the email was sent to", () => {
  assert.deepEqual(chooseFrom({ ...account, requested: null, inboundTo: ["julia@example.com", "hello@prowse.co.za"] }), {
    address: "hello@prowse.co.za",
  });
  assert.deepEqual(chooseFrom({ ...account, requested: "", inboundTo: ["julia@example.com"] }), { address: "matthew@prowse.co.za" });
  assert.deepEqual(chooseFrom({ ...account, requested: null, inboundTo: [] }), { address: "matthew@prowse.co.za" });
});

test("recipients must be plausible addresses", () => {
  assert.equal(isEmailAddress("julia@example.com"), true);
  assert.equal(isEmailAddress("j.smith+tag@mail.example.co.za"), true);
  for (const bad of ["julia", "julia@", "@example.com", "julia@example", "ju lia@example.com", "a@b@c.com", "a@example..com", "<a@example.com>", "a@example.com, b@example.com"]) {
    assert.equal(isEmailAddress(bad), false, bad);
  }
  assert.deepEqual(cleanRecipients([" Julia@Example.com", "julia@example.com", "sam@example.com"]), ["julia@example.com", "sam@example.com"]);
  assert.equal(cleanRecipients([]), null);
  assert.equal(cleanRecipients(["julia@example.com", "nope"]), null);
  assert.ok(BAD_RECIPIENTS.length > 0);
});

test("fromCandidates uses the latest inbound To, else the address your own email went from", () => {
  const inbound = { direction: "inbound", to_addresses: ["hello@prowse.co.za"], sender_address: "julia@example.com" };
  const mine = { direction: "outbound", to_addresses: ["julia@example.com"], sender_address: "hello@prowse.co.za" };
  assert.deepEqual(fromCandidates([mine, inbound]), ["hello@prowse.co.za"]);
  assert.deepEqual(fromCandidates([mine]), ["hello@prowse.co.za"]);
  assert.deepEqual(fromCandidates([]), []);
  assert.deepEqual(chooseFrom({ requested: null, ...account, inboundTo: fromCandidates([mine]) }), { address: "hello@prowse.co.za" });
});

test("a reply to a chosen email goes to its sender, from the address it was sent to", () => {
  const self = new Set(["me@example.com", "alias@example.com"]);
  assert.deepEqual(
    replyToChosen({ direction: "inbound", sender_address: "Sam@Example.org", to_addresses: ["alias@example.com"] }, self),
    { to: ["sam@example.org"], inboundTo: ["alias@example.com"] },
  );
});

test("a reply to your own email goes to the people it went to, from the address it went out from", () => {
  const self = new Set(["me@example.com"]);
  assert.deepEqual(
    replyToChosen({ direction: "outbound", sender_address: "me@example.com", to_addresses: ["a@x.com", "me@example.com", "A@x.com"] }, self),
    { to: ["a@x.com"], inboundTo: ["me@example.com"] },
  );
});

test("an email between your own addresses is answered to the address it came from", () => {
  const self = new Set(["me@gmail.com", "me@example.com"]);
  assert.deepEqual(
    replyToChosen({ direction: "outbound", sender_address: "Me@Gmail.com", to_addresses: ["me@example.com"] }, self),
    { to: ["me@gmail.com"], inboundTo: ["me@gmail.com"] },
  );
});

test("a reply with no one else writing goes to the other people, else the latest sender", () => {
  const self = new Set(["me@gmail.com", "me@example.com"]);
  assert.deepEqual(replyToParticipants(["a@x.com", "me@example.com", "A@x.com"], "me@gmail.com", self), ["a@x.com"]);
  assert.deepEqual(replyToParticipants(["me@example.com"], "Me@Gmail.com", self), ["me@gmail.com"]);
  assert.deepEqual(replyToParticipants([], null, self), []);
});

const none = { to_addresses: [], cc_addresses: [], bcc_addresses: [] };

test("a new email needs a To, and Cc and Bcc are optional", () => {
  assert.deepEqual(outgoingRecipients({ ...none, to_addresses: [" A@x.com "], bcc_addresses: ["b@x.com"] }, false), {
    to: ["a@x.com"], cc: [], bcc: ["b@x.com"], explicit: false,
  });
  assert.deepEqual(outgoingRecipients(none, false), { error: BAD_RECIPIENTS });
  assert.deepEqual(outgoingRecipients({ ...none, cc_addresses: ["b@x.com"] }, false), { error: BAD_RECIPIENTS });
});

test("a reply with To or Cc set goes to exactly those; with neither it is worked out", () => {
  assert.deepEqual(outgoingRecipients({ ...none, to_addresses: ["a@x.com"], cc_addresses: ["b@x.com"] }, true), {
    to: ["a@x.com"], cc: ["b@x.com"], bcc: [], explicit: true,
  });
  assert.deepEqual(outgoingRecipients({ ...none, cc_addresses: ["b@x.com"] }, true), { to: [], cc: ["b@x.com"], bcc: [], explicit: true });
  assert.deepEqual(outgoingRecipients(none, true), { to: [], cc: [], bcc: [], explicit: false });
  assert.deepEqual(outgoingRecipients({ ...none, bcc_addresses: ["c@x.com"] }, true), { to: [], cc: [], bcc: ["c@x.com"], explicit: false });
});

test("someone on two lines is kept on the first, and a bad or unreadable address fails the send", () => {
  assert.deepEqual(
    outgoingRecipients({ to_addresses: ["a@x.com"], cc_addresses: ["A@x.com", "b@x.com"], bcc_addresses: ["b@x.com", "c@x.com"] }, false),
    { to: ["a@x.com"], cc: ["b@x.com"], bcc: ["c@x.com"], explicit: false },
  );
  assert.deepEqual(outgoingRecipients({ ...none, to_addresses: ["a@x.com"], cc_addresses: ["nope"] }, false), { error: BAD_RECIPIENTS });
  assert.deepEqual(outgoingRecipients({ ...none, to_addresses: ["a@x.com"], bcc_addresses: [""] }, false), { error: BAD_RECIPIENTS });
});

test("line breaks are stripped from addresses before they are checked", () => {
  assert.deepEqual(outgoingRecipients({ ...none, to_addresses: ["a@x.com\r\nBcc: evil@x.com"] }, false), { error: BAD_RECIPIENTS });
  assert.deepEqual(outgoingRecipients({ ...none, to_addresses: ["a@x\r\n.com"] }, false), { to: ["a@x.com"], cc: [], bcc: [], explicit: false });
});
