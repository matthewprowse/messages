// The reply box (composer.tsx with its draft bar, attachments, templates and Send Later menu): what typing, Send and the
// AI controls ask the store for, and what the box refuses. Send is wired to the store as thread-view.tsx wires it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { Composer } from "./composer";
import { argsOf } from "@/test/fake-store";
import { fakeSupabase } from "@/test/fake-supabase";
import { renderScreen, type ScreenOptions } from "@/test/render";
import { KITCHEN, KITCHEN_MESSAGES } from "@/test/fixtures";
import type { Thread } from "@/lib/types";

let opened = 0;

/**
 * The composer inside the fake store, with onSend and onDraft going to the store's send and generateDraft. Each render
 * is a conversation of its own, since the box remembers what was typed in each conversation for the whole session.
 */
function renderComposer(base: Thread = KITCHEN, options: ScreenOptions = {}) {
  const thread = { ...base, id: `${base.id}-${++opened}` };
  let call: { send?: (...a: never[]) => unknown; draft?: (...a: never[]) => unknown } = {};
  const s = renderScreen(
    <Composer
      thread={thread}
      msgs={KITCHEN_MESSAGES}
      onDraft={(tone, instruction, decision, source) => call.draft?.(...([thread.id, tone, instruction, decision, source] as never[]))}
      onDiscardDraft={() => undefined}
      onSend={async (body, from, files, copies, sendAt) => (await call.send?.(...([thread.id, body, from, files, false, copies, sendAt] as never[]))) as boolean}
    />,
    options,
  );
  call = { send: s.store.send, draft: s.store.generateDraft };
  return s;
}

const box = () => screen.getByPlaceholderText("Message");
const sendButton = () => screen.getByRole("button", { name: "Send" });

test("typing a reply and pressing Send queues it with the text", async () => {
  const { user, store } = renderComposer();
  await user.type(box(), "Thanks Ava, the quote is attached.");
  await user.click(sendButton());
  assert.equal(store.send.mock.callCount(), 1);
  const [threadId, body] = argsOf(store.send)[0];
  assert.match(String(threadId), new RegExp(`^${KITCHEN.id}`));
  assert.equal(body, "Thanks Ava, the quote is attached.");
  await waitFor(() => assert.equal((box() as HTMLTextAreaElement).value, ""));
});

test("Send stays off for an empty box or only spaces, and Cmd+Enter does nothing then", async () => {
  const { user, store } = renderComposer();
  assert.equal((sendButton() as HTMLButtonElement).disabled, true);
  await user.type(box(), "   ");
  assert.equal((sendButton() as HTMLButtonElement).disabled, true);
  await user.type(box(), "{Meta>}{Enter}{/Meta}");
  assert.equal(store.send.mock.callCount(), 0);
});

test("Cmd+Enter sends, and a plain Enter adds a line instead", async () => {
  const { user, store } = renderComposer();
  await user.type(box(), "First line{Enter}Second line");
  assert.equal(store.send.mock.callCount(), 0);
  await user.type(box(), "{Meta>}{Enter}{/Meta}");
  assert.equal(argsOf(store.send)[0][1], "First line\nSecond line");
});

test("a send that could not be queued keeps the text in the box", async () => {
  const { user, store } = renderComposer();
  store.send.mock.mockImplementation(async () => false);
  await user.type(box(), "Keep me");
  await user.click(sendButton());
  await waitFor(() => assert.equal(store.send.mock.callCount(), 1));
  assert.equal((box() as HTMLTextAreaElement).value, "Keep me");
});

test("an AI draft fills the box, is marked AI Draft, and Send sends it as written", async () => {
  const draft = { id: "draft-1", body: "Hi Ava, I will add the oak worktops as their own line.", tone: "default" as const, generatedAt: new Date().toISOString() };
  const { user, store } = renderComposer({ ...KITCHEN, draft });
  await waitFor(() => assert.equal((box() as HTMLTextAreaElement).value, draft.body));
  assert.ok(screen.getByText("AI Draft"));
  await user.click(sendButton());
  assert.equal(argsOf(store.send)[0][1], draft.body);
});

test("Draft asks the store for a draft, with what the reply should say", async () => {
  const { user, store } = renderComposer();
  await user.type(screen.getByRole("textbox", { name: "What Should This Say?" }), "Say yes to Thursday");
  await user.click(screen.getByRole("button", { name: "Draft" }));
  const [threadId, tone, instruction] = argsOf(store.generateDraft)[0];
  assert.ok(String(threadId).startsWith(KITCHEN.id));
  assert.deepEqual([tone, instruction], ["custom", "Say yes to Thursday"]);
});

test("a picked file is listed as a chip with its name and can be removed", async () => {
  const { user, container } = renderComposer();
  const input = container.querySelector<HTMLInputElement>("input[type=file]");
  assert.ok(input, "the file picker is in the box");
  await user.upload(input, new File(["quote"], "Quote 2041.pdf", { type: "application/pdf" }));
  const list = screen.getByRole("list", { name: "Attachments" });
  assert.ok(within(list).getByText("Quote 2041.pdf"));
  // A file alone is enough to send.
  assert.equal((sendButton() as HTMLButtonElement).disabled, false);
  await user.click(screen.getByRole("button", { name: "Remove Quote 2041.pdf" }));
  assert.equal(screen.queryByRole("list", { name: "Attachments" }), null);
});

test("Insert Template puts the template in the box with the person's first name filled in", async () => {
  fakeSupabase.answer("from:user_templates", { data: [{ id: "tpl-1", kind: "template", title: "Quote Follow Up", shortcut: "", body: "Hi {first_name}, just checking the quote reached you." }], error: null });
  const { user } = renderComposer(KITCHEN, { auth: true });
  await user.click(screen.getByRole("button", { name: "Insert Template" }));
  await user.click(await screen.findByRole("menuitem", { name: "Quote Follow Up" }));
  assert.equal((box() as HTMLTextAreaElement).value, "Hi Ava, just checking the quote reached you.");
});

test("with no templates the menu offers to add the first one", async () => {
  const { user } = renderComposer();
  await user.click(screen.getByRole("button", { name: "Insert Template" }));
  const add = await screen.findByRole("menuitem", { name: "Add Your First Template" });
  assert.equal(add.getAttribute("href"), "/settings/drafts#templates");
});

test("Send Later sends with the chosen time, and is off while the box is empty", async () => {
  const { user, store } = renderComposer();
  assert.equal((screen.getByRole("button", { name: "Send Later" }) as HTMLButtonElement).disabled, true);
  await user.type(box(), "Morning reply");
  await user.click(screen.getByRole("button", { name: "Send Later" }));
  const [first] = await screen.findAllByRole("menuitem");
  await user.click(first);
  const sendAt = argsOf(store.send)[0][6];
  assert.equal(typeof sendAt, "string");
  assert.ok(Date.parse(sendAt as string) > Date.now(), "a later time");
});
