// Prints the test vectors that pin the ciphertext format. Run once; the TS and Python tests check against
// the saved vectors.json, so a change to the format shows up as a failing test in both languages.
import { addressKey, chatKey, domainKey } from "../src/addresses";
import { blindIndex, deriveUserKeys, encryptField } from "../src/index";
import { localWrapper } from "../src/wrap";

const dataKey = Uint8Array.from({ length: 32 }, (_, i) => i);
const keys = await deriveUserKeys(dataKey);
const cases = [
  { field: "messages.body_text", plaintext: "Hi Sam,\n\nThe plans are attached.\n\nThanks", nonce: Array.from({ length: 12 }, (_, i) => 100 + i) },
  { field: "threads.subject", plaintext: "Café ☕ – résumé", nonce: Array.from({ length: 12 }, (_, i) => 200 + i) },
  { field: "messages.subject", plaintext: "", nonce: Array.from({ length: 12 }, () => 7) },
];
const out = {
  dataKeyHex: Buffer.from(dataKey).toString("hex"),
  fields: await Promise.all(cases.map(async (c) => ({ ...c, ciphertext: await encryptField(keys, c.field, c.plaintext, Uint8Array.from(c.nonce)) }))),
  blindIndexes: await Promise.all(["sam@example.com", "+27824160503"].map(async (value) => ({ value, token: await blindIndex(keys, value) }))),
  // What each kind of address is indexed as, written different ways: every spelling must give the same key.
  addressKeys: [
    ...["Sam@Example.com ", " sam@example.com", "+27 82 416 0503", "27824160503", "+27(82)416-0503", "123456789012@lid", "Sam", "12"].map((value) => ({ kind: "address", value, key: addressKey(value) })),
    ...["27824160503@s.whatsapp.net", "120363025246125486@G.US"].map((value) => ({ kind: "chat", value, key: chatKey(value) })),
    ...["Example.co.za", "@example.co.za", "example.co.za."].map((value) => ({ kind: "domain", value, key: domainKey(value) })),
  ],
};
// A data key wrapped by the local wrapper, which the Python worker must be able to unwrap.
const masterKeyBase64 = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 255 - i)).toString("base64");
const userId = "caabe3e9-0000-4000-8000-000000000001";
const wrapped = await (await localWrapper(masterKeyBase64)).wrap(dataKey, userId);
console.log(JSON.stringify({ ...out, localWrap: { masterKeyBase64, userId, wrapped } }, null, 2));
