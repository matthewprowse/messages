// The Edit Contact dialog (contact-edit-dialog.tsx): it opens on the contact as stored, saves changes through
// update_contact (keeping the stored name when it is unchanged), removes an address with Undo before saving, and saves
// the About note on its own.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor } from "@testing-library/react";
import { FIELD } from "@messages/crypto/fields";
import { open } from "@/lib/vault";
import type { ContactDetail } from "@/lib/contacts";
import { EditContactDialog } from "./contact-edit-dialog";
import { argsOf } from "@/test/fake-store";
import { fakeSupabase } from "@/test/fake-supabase";
import { renderScreen } from "@/test/render";
import { AVA } from "@/test/fixtures";
import { summary } from "@/test/contacts-fixtures";
import { fakeKeyService } from "@/test/fake-keys";

fakeKeyService();

const DETAIL: ContactDetail = {
  ...summary(AVA, { role: "Director" }), relationship: "Client", leadSource: null, summary: null, aboutNote: "Prefers calls after ten.", organization: null,
  conversations: [], attachments: [],
  identityRows: [{ id: "id-email", kind: "email", value: "ava.thompson@example.com" }, { id: "id-phone", kind: "phone", value: "+27820000002" }, { id: "id-wa", kind: "whatsapp", value: "+27820000002" }],
};

function renderDialog(contact = DETAIL) {
  const onOpenChange = mock.fn((_: boolean) => undefined);
  const s = renderScreen(<EditContactDialog contact={contact} open onOpenChange={onOpenChange} />, { path: `/contacts/${contact.id}` });
  return { ...s, onOpenChange };
}

const updates = () => fakeSupabase.callsTo("rpc:update_contact").map((c) => c.steps[0].args[1] as Record<string, unknown>);

test("the form opens on the contact as stored, with each address and number listed once", () => {
  renderDialog();
  assert.equal((screen.getByLabelText("Name") as HTMLInputElement).value, "Ava Thompson");
  assert.equal((screen.getByLabelText("Company") as HTMLInputElement).value, "Thompson Interiors");
  assert.equal((screen.getByLabelText("Role") as HTMLInputElement).value, "Director");
  assert.equal((screen.getByLabelText("About") as HTMLTextAreaElement).value, "Prefers calls after ten.");
  assert.ok(screen.getByText("ava.thompson@example.com"));
  // The phone and its WhatsApp entry are one row, removed together.
  assert.equal(screen.getAllByRole("button", { name: /^Remove / }).length, 2);
});

test("saving with the name unchanged keeps the stored name and closes", async () => {
  const { user, store, onOpenChange } = renderDialog();
  await user.clear(screen.getByLabelText("Role"));
  await user.type(screen.getByLabelText("Role"), "Owner");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => assert.deepEqual(argsOf(onOpenChange), [[false]]));
  const [args] = updates();
  assert.equal(args.p_contact, AVA.id);
  assert.equal(args.p_name, null);
  assert.equal(await open(FIELD.contactRole, args.p_role as string), "Owner");
  assert.deepEqual(argsOf(store.refreshContacts), [[[AVA.id]]]);
});

test("a removed number can be put back with Undo, and Save removes both its phone and WhatsApp entries", async () => {
  const { user } = renderDialog();
  const remove = screen.getByRole("button", { name: /^Remove \+27/ });
  await user.click(remove);
  await user.click(screen.getByRole("button", { name: "Undo" }));
  await user.click(screen.getByRole("button", { name: /^Remove \+27/ }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => assert.equal(updates().length, 1));
  assert.deepEqual(updates()[0].p_remove, ["id-phone", "id-wa"]);
});

test("a changed About note is saved on its own, after the details", async () => {
  const { user } = renderDialog();
  await user.clear(screen.getByLabelText("About"));
  await user.type(screen.getByLabelText("About"), "Met at the Cape Town expo.");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => assert.equal(fakeSupabase.callsTo("from:contacts").length, 1));
  const [call] = fakeSupabase.callsTo("from:contacts");
  assert.deepEqual(call.steps.map((s) => s.name), ["from", "update", "eq"]);
  const note = (call.steps[1].args[0] as { about_note: string }).about_note;
  assert.equal(await open(FIELD.contactAbout, note), "Met at the Cape Town expo.");
});

test("an emptied name is refused and nothing is saved", async () => {
  const { user } = renderDialog();
  await user.clear(screen.getByLabelText("Name"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  assert.ok(screen.getByText("Add a name."));
  assert.equal(updates().length, 0);
});

test("a failed save says why and keeps the dialog open", async () => {
  fakeSupabase.answer("rpc:update_contact", { data: null, error: { message: "boom", code: "XX000" } });
  const { user, onOpenChange } = renderDialog();
  await user.click(screen.getByRole("button", { name: "Save" }));
  assert.equal((await screen.findByRole("alert")).textContent, "Could not save. Check your connection and try again.");
  assert.equal(onOpenChange.mock.callCount(), 0);
});
