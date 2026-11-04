// Tests for backfill/names.ts: planName seals readable names once, indexes group names, leaves sealed and team values
// alone, and a second run over its own output finds nothing to do.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptField, deriveTeamKeys, deriveUserKeys, encryptField, encryptTeamField, isCiphertext, newDataKey } from "@messages/crypto";
import { groupNameIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { NAME_SPECS, planName } from "./names";

const keys = await deriveUserKeys(newDataKey());
const spec = (table: string) => NAME_SPECS.find((s) => s.table === table)!;

test("a readable contact name is sealed as a name and opens back exactly", async () => {
  const plan = await planName(keys, spec("contacts"), { display_name: "Zoë Mokoena " }, "encrypt");
  assert.deepEqual(plan!.expect, { display_name: "Zoë Mokoena " });
  assert.equal(isCiphertext(plan!.set.display_name), true);
  assert.equal(await decryptField(keys, FIELD.name, plan!.set.display_name!), "Zoë Mokoena ");
});

test("running again over what it wrote finds nothing to do (idempotent), for every table", async () => {
  for (const s of NAME_SPECS) {
    const row: Record<string, unknown> = { [s.column]: "Acme Holdings" };
    const first = await planName(keys, s, row, "encrypt");
    assert.ok(first, s.table);
    Object.assign(row, first.set);
    assert.equal(await planName(keys, s, row, "encrypt"), null, s.table);
  }
});

test("a group's name gets its index, also when it was already sealed without one", async () => {
  const plan = await planName(keys, spec("threads"), { group_name: "Family", group_name_index: null }, "encrypt");
  assert.equal(plan!.set.group_name_index, await groupNameIndex(keys, "Family"));
  assert.deepEqual(plan!.expect, { group_name: "Family", group_name_index: null });
  const sealed = await encryptField(keys, FIELD.name, "Book Club");
  const onlyIndex = await planName(keys, spec("threads"), { group_name: sealed, group_name_index: null }, "encrypt");
  assert.deepEqual(onlyIndex, { expect: { group_name_index: null }, set: { group_name_index: await groupNameIndex(keys, "Book Club") } });
});

test("empty names and a shared chat's team-sealed name are left alone", async () => {
  assert.equal(await planName(keys, spec("contacts"), { display_name: "" }, "encrypt"), null);
  assert.equal(await planName(keys, spec("organizations"), { name: null }, "encrypt"), null);
  const team = await encryptTeamField(await deriveTeamKeys(newDataKey()), FIELD.name, "Deal Team");
  assert.equal(await planName(keys, spec("threads"), { group_name: team, group_name_index: null }, "encrypt"), null);
});

test("the way back restores the readable name and only touches sealed ones", async () => {
  const sealed = await encryptField(keys, FIELD.name, "Pieter van Wyk");
  assert.deepEqual((await planName(keys, spec("contacts"), { display_name: sealed }, "decrypt"))!.set, { display_name: "Pieter van Wyk" });
  assert.equal(await planName(keys, spec("contacts"), { display_name: "Pieter van Wyk" }, "decrypt"), null);
});

test("a name sealed as another kind of text fails and is reported, never half written", async () => {
  const wrong = await encryptField(keys, FIELD.subject, "x");
  await assert.rejects(planName(keys, spec("contacts"), { display_name: wrong }, "decrypt"));
  await assert.rejects(planName(keys, spec("threads"), { group_name: wrong, group_name_index: null }, "encrypt"));
});
