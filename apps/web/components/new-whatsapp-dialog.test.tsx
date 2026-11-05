// The New WhatsApp Message dialog (new-whatsapp-dialog.tsx): picking a number or a contact, what Send queues through the
// store's composeWhatsApp, what it refuses (a number that cannot be one, an empty message), and a number that already has
// a chat, where the message goes as a reply instead.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor } from "@testing-library/react";
import { NewWhatsAppDialog } from "./new-whatsapp-dialog";
import { argsOf } from "@/test/fake-store";
import { renderScreen, type ScreenOptions } from "@/test/render";
import { ACCOUNT, CHLOE, WHATSAPP_ACCOUNT, thread } from "@/test/fixtures";
import { PHONE_HINT } from "@/lib/new-items";

function renderDialog(options: ScreenOptions = {}, to?: { phone: string; name?: string }) {
  const onOpenChange = mock.fn((_: boolean) => undefined);
  const s = renderScreen(<NewWhatsAppDialog open onOpenChange={onOpenChange} to={to} />, { accounts: [ACCOUNT, WHATSAPP_ACCOUNT], ...options });
  return { ...s, onOpenChange };
}

const toBox = () => screen.getByPlaceholderText("Name or number, like +44 7700 900123");
const message = () => screen.getByLabelText("Message") as HTMLTextAreaElement;
const sendButton = () => screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;

test("without a linked WhatsApp the dialog says to link it first", () => {
  renderDialog({ accounts: [ACCOUNT] });
  assert.equal(screen.getByRole("link", { name: "Link WhatsApp" }).getAttribute("href"), "/settings/accounts/whatsapp");
  assert.equal(screen.queryByRole("button", { name: "Send" }), null);
});

test("a typed number is offered, picked, and the message is queued to it from the linked account", async () => {
  const { user, store } = renderDialog();
  await user.type(toBox(), "+27 82 555 0123");
  await user.click(await screen.findByRole("option", { name: /Message \+27825550123/ }));
  assert.ok(screen.getByRole("button", { name: "Change Recipient" }));
  await user.type(message(), "Hi, this is about the quote.");
  await user.click(sendButton());
  await waitFor(() => assert.equal(store.composeWhatsApp.mock.callCount(), 1));
  assert.deepEqual(argsOf(store.composeWhatsApp)[0], [WHATSAPP_ACCOUNT.id, "+27825550123", "Hi, this is about the quote.", undefined, undefined]);
});

test("a local number takes the country of your own WhatsApp number", async () => {
  const { user } = renderDialog();
  await user.type(toBox(), "082 555 0123");
  assert.ok(await screen.findByRole("option", { name: /Message \+27825550123/ }));
});

test("typing a name offers the contacts with a number, and picking one sends to their number", async () => {
  const { user, store } = renderDialog({ contacts: [CHLOE], threads: [] });
  await user.type(toBox(), "chloe");
  await user.click(await screen.findByRole("option", { name: /Chloe Naidoo/ }));
  assert.ok(screen.getByText("Chloe Naidoo"));
  assert.equal(screen.queryByPlaceholderText("Name or number, like +44 7700 900123"), null);
  await user.type(message(), "See you Wednesday.");
  await user.click(sendButton());
  await waitFor(() => assert.equal(argsOf(store.composeWhatsApp)[0]?.[1], "+27820000001"));
});

test("something that cannot be a number is refused with the hint, and Send stays off", async () => {
  const { user, store } = renderDialog();
  await user.type(toBox(), "call me");
  await user.type(message(), "Hello");
  await user.click(message());
  assert.ok(screen.getByText(PHONE_HINT));
  assert.equal(sendButton().disabled, true);
  assert.equal(store.composeWhatsApp.mock.callCount(), 0);
});

test("Send stays off until there is a message", async () => {
  const { user } = renderDialog({}, { phone: "+27825550123" });
  assert.equal(sendButton().disabled, true);
  await user.type(message(), "  ");
  assert.equal(sendButton().disabled, true);
});

test("opened for someone, the recipient is already chosen, and Change Recipient lets you pick again", async () => {
  const { user } = renderDialog({}, { phone: "+27825550123", name: "Daniel Mokoena" });
  assert.ok(screen.getByText("Daniel Mokoena"));
  await user.click(screen.getByRole("button", { name: "Change Recipient" }));
  assert.ok(toBox());
});

test("a number that already has a chat sends there as a reply and opens it", async () => {
  const chat = thread("thread-wa-existing", { channel: "whatsapp", provider: "whatsapp", accountId: WHATSAPP_ACCOUNT.id, fallbackName: "+27825550123", participantIds: [] });
  const { user, store, router } = renderDialog({ threads: [chat], contacts: [CHLOE] }, { phone: "+27825550123" });
  assert.ok(screen.getByText(/You already have a chat with this number/));
  await user.type(message(), "Following up here.");
  await user.click(sendButton());
  await waitFor(() => assert.equal(store.send.mock.callCount(), 1));
  assert.deepEqual(argsOf(store.send)[0], [chat.id, "Following up here.", undefined, [], true, undefined, undefined]);
  assert.equal(store.composeWhatsApp.mock.callCount(), 0);
  assert.deepEqual(argsOf(router.push), [[`/inbox/${chat.id}`]]);
});
