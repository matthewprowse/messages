// The merge confirm dialog (merge-dialog.tsx): one Merge button when the names agree, the two names as the choice when
// they differ, the store's mergeContacts called with both ids and the chosen name, Merging while it runs, and Cancel.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor } from "@testing-library/react";
import { MergeDialog } from "./merge-dialog";
import { useApp } from "@/lib/store";
import { argsOf } from "@/test/fake-store";
import { renderScreen, type ScreenOptions } from "@/test/render";

type Person = { id: string; name: string };

/** Wired as contact-merge-actions.tsx wires it: confirming merges b into a with the name picked. */
function Harness({ a, b, onOpenChange }: { a: Person; b: Person; onOpenChange: (open: boolean) => void }) {
  const { mergeContacts } = useApp();
  return <MergeDialog a={a} b={b} open onOpenChange={onOpenChange} onConfirm={async (name) => { await mergeContacts(a.id, b.id, "manual", name); }} />;
}

function renderMerge(a: Person, b: Person, options: ScreenOptions = {}) {
  const onOpenChange = mock.fn((_: boolean) => undefined);
  const s = renderScreen(<Harness a={a} b={b} onOpenChange={onOpenChange} />, options);
  return { ...s, onOpenChange };
}

test("the same person under two spellings gets one Merge button, and merging keeps the first", async () => {
  const { user, store, onOpenChange } = renderMerge({ id: "contact-ava", name: "Ava Thompson" }, { id: "contact-ava-2", name: "ava thompson" });
  assert.ok(screen.getByRole("alertdialog", { name: "Merge These Contacts?" }));
  await user.click(screen.getByRole("button", { name: "Merge" }));
  await waitFor(() => assert.deepEqual(argsOf(onOpenChange), [[false]]));
  assert.deepEqual(argsOf(store.mergeContacts), [["contact-ava", "contact-ava-2", "manual", undefined]]);
});

test("two different names are the choice, and the one picked is the name kept", async () => {
  const { user, store } = renderMerge({ id: "contact-ben", name: "Ben Carter" }, { id: "contact-bc", name: "Benjamin Carter-Smith" });
  assert.ok(screen.getByRole("alertdialog", { name: "Which Name Should We Keep?" }));
  assert.ok(screen.getByText(/Ben Carter and Benjamin Carter-Smith become one contact/));
  await user.click(screen.getByRole("button", { name: "Benjamin Carter-Smith" }));
  await waitFor(() => assert.equal(store.mergeContacts.mock.callCount(), 1));
  assert.deepEqual(argsOf(store.mergeContacts)[0], ["contact-ben", "contact-bc", "manual", "Benjamin Carter-Smith"]);
});

test("a name that is only an address gives way to the real name without asking", async () => {
  const { user, store } = renderMerge({ id: "contact-x", name: "chloe.naidoo@example.net" }, { id: "contact-chloe", name: "Chloe Naidoo" });
  await user.click(screen.getByRole("button", { name: "Merge" }));
  await waitFor(() => assert.equal(store.mergeContacts.mock.callCount(), 1));
});

test("while the merge runs the button says Merging and nothing else can be pressed", async () => {
  const { user, store } = renderMerge({ id: "contact-ava", name: "Ava Thompson" }, { id: "contact-ava-2", name: "Ava Thompson" });
  // A merge that has not answered yet.
  store.mergeContacts.mock.mockImplementation(() => new Promise<string | null>(() => undefined));
  await user.click(screen.getByRole("button", { name: "Merge" }));
  const busy = await screen.findByRole("button", { name: "Merging" });
  assert.equal((busy as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled, true);
});

test("Cancel closes without merging", async () => {
  const { user, store, onOpenChange } = renderMerge({ id: "contact-ava", name: "Ava Thompson" }, { id: "contact-ava-2", name: "Ava Thompson" });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  assert.deepEqual(argsOf(onOpenChange), [[false]]);
  assert.equal(store.mergeContacts.mock.callCount(), 0);
});
