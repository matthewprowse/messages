// One message bubble (bubble.tsx): its text, Reply and reactions, the send states under a reply you sent (Waiting to
// Send, a failure with Retry or Delete, May Have Been Sent with no Retry, a scheduled reply's Send Now and Cancel), and
// Seen and WhatsApp's ticks.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import { Bubble, type BubbleHandlers } from "./bubble";
import { argsOf } from "@/test/fake-store";
import { renderScreen } from "@/test/render";
import { KITCHEN, KITCHEN_MESSAGES, message } from "@/test/fixtures";
import type { Message } from "@/lib/types";

/** The bubble with a spy for every handler. */
function renderBubble(m: Message, extra: { whatsapp?: boolean; seen?: boolean; showMeta?: boolean } = {}) {
  const handlers = {
    whatsapp: extra.whatsapp ?? false, nameOf: (who: string) => (who === "me" ? "You" : "Ava Thompson"),
    onJump: mock.fn((_id: string) => undefined), onReply: mock.fn((_m: Message) => undefined), onReact: mock.fn((_m: Message, _e: string) => undefined),
    onOpen: mock.fn(), onRetry: mock.fn((_m: Message) => undefined), onDismiss: mock.fn((_m: Message) => undefined),
  } satisfies BubbleHandlers;
  const s = renderScreen(<Bubble m={m} showMeta={extra.showMeta ?? true} seen={extra.seen} flash={false} {...handlers} />);
  return { ...s, ...handlers };
}

const [, MINE, THEIRS] = KITCHEN_MESSAGES;
const sent = (extra: Partial<Message>) => message("outbox:outbox-7", KITCHEN.id, "me", "I will send the quote today.", 1, extra);

test("a received message shows its text, and Reply hands the message up", async () => {
  const { user, onReply } = renderBubble(THEIRS);
  assert.ok(screen.getByText(THEIRS.body));
  await user.click(screen.getByRole("button", { name: "Reply" }));
  assert.deepEqual(onReply.mock.calls.map((c) => c.arguments[0].id), [THEIRS.id]);
});

test("a reply still queued says Waiting to Send and offers no Reply", () => {
  renderBubble(sent({ sendState: "queued" }));
  assert.ok(screen.getByText("Waiting to Send"));
  assert.equal(screen.queryByRole("button", { name: "Reply" }), null);
});

test("a failed send that surely did not go shows the reason, Retry and Delete", async () => {
  const m = sent({ sendState: "failed", sendRecovery: "retry", sendError: "The mail server refused the message." });
  const { user, onRetry, onDismiss } = renderBubble(m);
  assert.ok(screen.getByText("The mail server refused the message."));
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  assert.equal(onRetry.mock.callCount(), 1);
  assert.equal(onDismiss.mock.callCount(), 1);
});

test("a failure that may have gone out never offers Retry, only Copy Text and Delete", () => {
  renderBubble(sent({ sendState: "failed", sendRecovery: "unsure" }));
  assert.ok(screen.getByText("May Have Been Sent."));
  assert.equal(screen.queryByRole("button", { name: "Retry" }), null);
  assert.ok(screen.getByRole("button", { name: "Copy Text" }));
});

test("a failure with no reason says Not Sent", () => {
  renderBubble(sent({ sendState: "failed", sendRecovery: "none" }));
  assert.ok(screen.getByText("Not Sent"));
  assert.equal(screen.queryByRole("button", { name: "Retry" }), null);
});

test("a scheduled reply says when, and Send Now and Cancel act on its outbox row", async () => {
  const at = new Date(Date.now() + 86_400_000).toISOString();
  const { user, store } = renderBubble(sent({ sendState: "queued", scheduledFor: at }));
  assert.ok(screen.getByText(/^Scheduled for /));
  await user.click(screen.getByRole("button", { name: "Send Now" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Edit" }));
  assert.deepEqual(argsOf(store.sendScheduledNow), [["outbox-7"]]);
  assert.deepEqual(argsOf(store.cancelScheduled), [["outbox-7", false], ["outbox-7", true]]);
});

test("an email you sent that they opened says Seen", () => {
  renderBubble(MINE, { seen: true });
  assert.ok(screen.getByText("Seen"));
});

test("a WhatsApp message you sent shows its ticks", () => {
  renderBubble({ ...MINE, whatsapp: true, receipt: "read" }, { whatsapp: true });
  assert.ok(screen.getByLabelText("Read"));
});

test("a WhatsApp reaction chip is yours to take back", async () => {
  const m = { ...THEIRS, whatsapp: true, reactions: { me: "👍", "+27820000001": "👍" } };
  const { user, onReact } = renderBubble(m, { whatsapp: true, showMeta: false });
  const chip = screen.getByRole("button", { name: "👍 2" });
  assert.equal(chip.getAttribute("aria-pressed"), "true");
  await user.click(chip);
  assert.deepEqual(onReact.mock.calls.map((c) => c.arguments[1]), [""]);
});

test("a missed call is a line, not a bubble", () => {
  renderBubble({ ...THEIRS, body: "", call: { video: false, missed: true } });
  assert.equal(screen.queryByRole("button", { name: "Reply" }), null);
  assert.ok(screen.getByText(/call/i));
});
