// The New Email dialog (compose-dialog.tsx with useComposeSend): what Send queues through the store's composeEmail, what
// it refuses (no message, no or bad addresses), Cc, Enter never sending from a single-line field, Send Later, and the
// Undo Send window while the queued email waits.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor } from "@testing-library/react";
import { ComposeDialog } from "./compose-dialog";
import type { NewEmail } from "@/lib/store";
import { argsOf } from "@/test/fake-store";
import { fakeSupabase } from "@/test/fake-supabase";
import { renderScreen, type ScreenOptions } from "@/test/render";
import { ACCOUNT, WHATSAPP_ACCOUNT } from "@/test/fixtures";

function renderCompose(options: ScreenOptions = {}, to: string[] = []) {
  const onOpenChange = mock.fn((_: boolean) => undefined);
  const s = renderScreen(<ComposeDialog open onOpenChange={onOpenChange} to={to} />, { toasts: true, ...options });
  return { ...s, onOpenChange };
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const sendButton = () => screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
const queued = (store: ReturnType<typeof renderCompose>["store"]) => argsOf(store.composeEmail).map((a) => a[0] as NewEmail);

/** Fills To, Subject and Message. */
async function fill(user: ReturnType<typeof renderCompose>["user"], to: string, subject: string, body: string) {
  if (to) await user.type(field("To"), to);
  if (subject) await user.type(field("Subject"), subject);
  if (body) await user.type(field("Message"), body);
}

test("with no email account connected the dialog points to Connected Accounts", () => {
  renderCompose({ accounts: [WHATSAPP_ACCOUNT] });
  assert.equal(screen.getByRole("link", { name: "Connected Accounts" }).getAttribute("href"), "/settings/accounts");
  assert.equal(screen.queryByRole("button", { name: "Send" }), null);
});

test("Send queues the email from the account's address to each recipient", async () => {
  const { user, store } = renderCompose();
  await fill(user, "ava.thompson@example.com, ben.carter@example.org", "Updated Quote", "Please find the updated quote below.");
  await user.click(sendButton());
  await waitFor(() => assert.equal(store.composeEmail.mock.callCount(), 1));
  const [email] = queued(store);
  assert.equal(email.accountId, ACCOUNT.id);
  assert.equal(email.fromAddress, ACCOUNT.sendAddresses[0]);
  assert.deepEqual(email.to, ["ava.thompson@example.com", "ben.carter@example.org"]);
  assert.deepEqual([email.subject, email.body, email.cc, email.bcc, email.sendAt], ["Updated Quote", "Please find the updated quote below.", [], [], undefined]);
});

test("Send stays off until there is a message", async () => {
  const { user } = renderCompose();
  await fill(user, "ava.thompson@example.com", "Hello", "");
  assert.equal(sendButton().disabled, true);
  await user.type(field("Message"), "   ");
  assert.equal(sendButton().disabled, true);
});

test("a message with nobody to send it to asks for an address and queues nothing", async () => {
  const { user, store } = renderCompose();
  await fill(user, "", "", "A message for nobody");
  await user.click(sendButton());
  assert.ok(screen.getByText("Add at least one address."));
  assert.equal(store.composeEmail.mock.callCount(), 0);
});

test("a malformed address is named and nothing is queued", async () => {
  const { user, store } = renderCompose();
  await fill(user, "ava.thompson@example.com, not-an-address", "", "Hello");
  await user.click(sendButton());
  assert.ok(screen.getByText("Check not-an-address."));
  assert.equal(field("To").getAttribute("aria-invalid"), "true");
  assert.equal(store.composeEmail.mock.callCount(), 0);
});

test("Cc is shown on request and nobody already in To is copied twice", async () => {
  const { user, store } = renderCompose();
  await user.click(screen.getByRole("button", { name: "Cc" }));
  await fill(user, "ava.thompson@example.com", "", "Copying Ben");
  await user.type(field("Cc"), "ben.carter@example.org, ava.thompson@example.com");
  await user.click(sendButton());
  await waitFor(() => assert.equal(store.composeEmail.mock.callCount(), 1));
  assert.deepEqual(queued(store)[0].cc, ["ben.carter@example.org"]);
});

test("Enter in the Subject never sends; Cmd+Enter in the message does", async () => {
  const { user, store } = renderCompose();
  await fill(user, "ava.thompson@example.com", "Quote", "Ready to go");
  await user.type(field("Subject"), "{Enter}");
  assert.equal(store.composeEmail.mock.callCount(), 0);
  await user.type(field("Message"), "{Meta>}{Enter}{/Meta}");
  await waitFor(() => assert.equal(store.composeEmail.mock.callCount(), 1));
});

test("opened for someone, To is filled in already", () => {
  renderCompose({}, ["chloe.naidoo@example.net"]);
  assert.equal(field("To").value, "chloe.naidoo@example.net");
});

test("Send Later queues it for the chosen time, closes, and says when it goes", async () => {
  const { user, store, onOpenChange } = renderCompose();
  await fill(user, "ava.thompson@example.com", "", "Tomorrow morning");
  await user.click(screen.getByRole("button", { name: "Send Later" }));
  const [first] = await screen.findAllByRole("menuitem");
  await user.click(first);
  await waitFor(() => assert.equal(store.composeEmail.mock.callCount(), 1));
  assert.ok(Date.parse(queued(store)[0].sendAt ?? "") > Date.now());
  assert.deepEqual(argsOf(onOpenChange), [[false]]);
  assert.ok(await screen.findByText(/^Scheduled for /));
});

test("while the queued email waits out Undo Send, the button counts down and Undo gives the email back", async () => {
  const sendAfter = new Date(Date.now() + 10_000).toISOString();
  fakeSupabase.answer("rpc:cancel_outbox", { data: true, error: null });
  const { user } = renderCompose({ overrides: { composed: { "outbox-new": { status: "queued", sendAfter } } } });
  await fill(user, "ava.thompson@example.com", "", "Second thoughts");
  await user.click(sendButton());
  assert.ok(await screen.findByRole("button", { name: /^Sending in \d+s$/ }));
  await user.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => assert.equal(fakeSupabase.callsTo("rpc:cancel_outbox").length, 1));
  assert.deepEqual(fakeSupabase.callsTo("rpc:cancel_outbox")[0].steps[0].args, ["cancel_outbox", { p_id: "outbox-new" }]);
  assert.ok(await screen.findByText("Cancelled. Your message is back in the box."));
  assert.equal(field("Message").value, "Second thoughts");
  assert.equal(sendButton().disabled, false);
});

test("an email the worker could not send says so", async () => {
  const { user } = renderCompose({ overrides: { composed: { "outbox-new": { status: "failed", error: "The mail server refused the message." } } } });
  await fill(user, "ava.thompson@example.com", "", "Hello");
  await user.click(sendButton());
  assert.ok(await screen.findByText("The mail server refused the message."));
});
