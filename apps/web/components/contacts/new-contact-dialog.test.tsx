// The New Contact dialog (contacts/new-contact-dialog.tsx with contact-fields.tsx): what it refuses before saving, what
// it saves through create_contact, and how a clash with someone already on file is offered instead.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor } from "@testing-library/react";
import { FIELD } from "@messages/crypto/fields";
import { open } from "@/lib/vault";
import { NewContactDialog } from "./new-contact-dialog";
import { argsOf } from "@/test/fake-store";
import { fakeSupabase } from "@/test/fake-supabase";
import { renderScreen } from "@/test/render";
import { fakeKeyService } from "@/test/fake-keys";

fakeKeyService();

function renderDialog() {
  const onOpenChange = mock.fn((_: boolean) => undefined);
  const s = renderScreen(<NewContactDialog open onOpenChange={onOpenChange} />, { path: "/contacts" });
  return { ...s, onOpenChange };
}

const save = () => screen.getByRole("button", { name: "Save" });
/** The create_contact call's arguments, as sent to the database. */
const created = () => fakeSupabase.callsTo("rpc:create_contact").map((c) => c.steps[0].args[1] as Record<string, unknown>);

test("Save without a name asks for one and saves nothing", async () => {
  const { user } = renderDialog();
  await user.click(save());
  assert.ok(screen.getByText("Add a name."));
  assert.equal(screen.getByLabelText("Name").getAttribute("aria-invalid"), "true");
  assert.equal(created().length, 0);
});

test("a malformed address or number is pointed out and nothing is saved", async () => {
  const { user } = renderDialog();
  await user.type(screen.getByLabelText("Name"), "Emma Fischer");
  await user.type(screen.getByLabelText("Email Addresses"), "emma.fischer@");
  await user.type(screen.getByLabelText("Phone Numbers"), "12");
  await user.click(save());
  assert.ok(screen.getByText("Check this address."));
  assert.equal(created().length, 0);
});

test("a second address line is added with the plus, and only once the first has text", async () => {
  const { user } = renderDialog();
  const add = screen.getByRole("button", { name: "Add Email Address" });
  assert.equal((add as HTMLButtonElement).disabled, true);
  await user.type(screen.getByLabelText("Email Addresses"), "emma.fischer@example.org");
  await user.click(add);
  assert.equal(screen.getAllByRole("textbox").filter((i) => i.getAttribute("type") === "email").length, 2);
  // Each line can be removed once there are two.
  assert.equal(screen.getAllByRole("button", { name: "Remove" }).length, 2);
});

test("Save creates the contact with the name and lower-cased address, then opens their page", async () => {
  fakeSupabase.answer("rpc:create_contact", { data: "contact-emma", error: null });
  const { user, router, store, onOpenChange } = renderDialog();
  await user.type(screen.getByLabelText("Name"), "  Emma Fischer ");
  await user.type(screen.getByLabelText("Email Addresses"), "Emma.Fischer@Example.org");
  await user.click(save());
  await waitFor(() => assert.deepEqual(argsOf(router.push), [["/contacts/contact-emma"]]));
  // The name and address leave the browser sealed; opened again with the same key they read as typed, tidied.
  const [args] = created();
  assert.equal(await open(FIELD.name, args.p_name as string), "Emma Fischer");
  const [identity] = args.p_identities as { kind: string; value: string }[];
  assert.equal(identity.kind, "email");
  assert.equal(await open(FIELD.address, identity.value), "emma.fischer@example.org");
  assert.deepEqual(argsOf(onOpenChange), [[false]]);
  assert.equal(store.refreshContacts.mock.callCount(), 1);
});

test("an address already on someone else says whose it is and offers Open Contact", async () => {
  const ben = "00000000-0000-4000-8000-0000000000be";
  fakeSupabase.answer("rpc:create_contact", { data: null, error: { code: "23505", message: "duplicate", details: ben } as never });
  fakeSupabase.answer("from:contacts", { data: { display_name: "Ben Carter" }, error: null });
  const { user, router } = renderDialog();
  await user.type(screen.getByLabelText("Name"), "Ben C");
  await user.type(screen.getByLabelText("Email Addresses"), "ben.carter@example.org");
  await user.click(save());
  assert.equal((await screen.findByRole("alert")).textContent, "One of these already belongs to Ben Carter.");
  await user.click(screen.getByRole("button", { name: "Open Contact" }));
  assert.deepEqual(argsOf(router.push), [[`/contacts/${ben}`]]);
});

test("Cancel closes without saving", async () => {
  const { user, onOpenChange } = renderDialog();
  await user.type(screen.getByLabelText("Name"), "Farid Patel");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  assert.deepEqual(argsOf(onOpenChange), [[false]]);
  assert.equal(created().length, 0);
});
