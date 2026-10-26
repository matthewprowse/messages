import { test } from "node:test";
import assert from "node:assert/strict";
import { peopleFromBatch } from "./people";

test("batchGet answers become names and addresses by Google ID", () => {
  const found = peopleFromBatch({
    responses: [
      {
        requestedResourceName: "people/222",
        person: {
          names: [{ displayName: "Piet" }, { displayName: "Pieter van Wyk", metadata: { primary: true } }],
          emailAddresses: [{ value: " Pieter@Client.co.za " }],
        },
      },
      { requestedResourceName: "people/333", person: { names: [{ displayName: "Naledi Dube" }] } },
      { requestedResourceName: "people/444", person: {} },
      { requestedResourceName: "people/555" },
    ],
  });
  assert.deepEqual([...found], [
    ["222", { name: "Pieter van Wyk", email: "pieter@client.co.za" }],
    ["333", { name: "Naledi Dube", email: null }],
  ]);
  assert.equal(peopleFromBatch({}).size, 0);
});
