// Tests for whatsapp/people.ts: names resolve with saved before pushed, a phone JID is the preferred identity, and
// "you" is recognised by either of your own ids. No link is used; the socket is a stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { WASocket } from "baileys";
import { People } from "./people";

const noSock = () => null;

test("a saved name beats a pushed name, and neither is needed to find the number", async () => {
  const people = new People(noSock);
  people.pushNames.set("27821234567@s.whatsapp.net", "Pushy");
  assert.equal(people.nameOf("27821234567@s.whatsapp.net"), "Pushy");
  people.savedNames.set("27821234567@s.whatsapp.net", "Saved");
  assert.equal(people.nameOf("27821234567@s.whatsapp.net"), "Saved");
  const p = await people.person("27821234567@s.whatsapp.net");
  assert.equal(p.jid, "27821234567@s.whatsapp.net");
  assert.equal(p.display_name, "Saved");
});

test("a privacy ID alone is looked up once and a miss is remembered as null", async () => {
  let asked = 0;
  const sock = { signalRepository: { lidMapping: { getPNForLID: async () => (asked++, null) } } } as unknown as WASocket;
  const people = new People(() => sock);
  const first = await people.person("123@lid");
  await people.person("123@lid");
  assert.equal(asked, 1);
  assert.equal(first.phone, null);
  assert.equal(first.jid, "123@lid");
});

test("isMe matches the account's phone or privacy ID, and is false with no link", async () => {
  const sock = { user: { id: "27821234567:5@s.whatsapp.net", lid: "999@lid" } } as unknown as WASocket;
  const people = new People(() => sock);
  assert.equal(people.isMe(await people.person("27821234567@s.whatsapp.net")), true);
  assert.equal(people.isMe(await people.person("27820000000@s.whatsapp.net")), false);
  assert.equal(new People(noSock).isMe(await people.person("27821234567@s.whatsapp.net")), false);
});
