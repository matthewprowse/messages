import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFolders, type ListedFolder } from "./imap-folders";

const folder = (path: string, more: Partial<ListedFolder> = {}): ListedFolder => ({ path, delimiter: "/", flags: new Set(), ...more });

test("special-use flags from the server win over names", () => {
  // iCloud, as it lists its folders.
  const icloud = [
    folder("INBOX"),
    folder("Archive", { specialUse: "\\Archive", specialUseSource: "extension" }),
    folder("Deleted Messages", { specialUse: "\\Trash", specialUseSource: "extension" }),
    folder("Drafts", { specialUse: "\\Drafts", specialUseSource: "extension" }),
    folder("Junk", { specialUse: "\\Junk", specialUseSource: "extension" }),
    folder("Sent Messages", { specialUse: "\\Sent", specialUseSource: "extension" }),
  ];
  assert.deepEqual(pickFolders(icloud), { sent: "Sent Messages", archive: "Archive", trash: "Deleted Messages", junk: "Junk" });

  // A server that marks "Sent Items" as Sent although a plain "Sent" folder exists too.
  const marked = [folder("Sent"), folder("Sent Items", { specialUse: "\\Sent", specialUseSource: "extension" })];
  assert.equal(pickFolders(marked).sent, "Sent Items");
});

test("cPanel and Dovecot folders under the Inbox, with a dot delimiter", () => {
  const cpanel = [
    folder("INBOX", { delimiter: "." }),
    folder("INBOX.Sent", { delimiter: "." }),
    folder("INBOX.Trash", { delimiter: "." }),
    folder("INBOX.spam", { delimiter: "." }),
    folder("INBOX.Archive", { delimiter: "." }),
    folder("INBOX.Drafts", { delimiter: "." }),
    folder("INBOX.Clients", { delimiter: "." }),
  ];
  assert.deepEqual(pickFolders(cpanel), { sent: "INBOX.Sent", archive: "INBOX.Archive", trash: "INBOX.Trash", junk: "INBOX.spam" });
});

test("Exchange and Outlook style names", () => {
  const exchange = [folder("INBOX"), folder("Sent Items"), folder("Deleted Items"), folder("Junk E-mail"), folder("Archive")];
  assert.deepEqual(pickFolders(exchange), { sent: "Sent Items", archive: "Archive", trash: "Deleted Items", junk: "Junk E-mail" });
});

test("common names, most likely first, top level before under the Inbox", () => {
  assert.equal(pickFolders([folder("Sent Mail"), folder("Sent")]).sent, "Sent");
  assert.equal(pickFolders([folder("INBOX/Sent"), folder("Sent")]).sent, "Sent");
  assert.equal(pickFolders([folder("Spam"), folder("Bulk Mail")]).junk, "Spam");
  assert.equal(pickFolders([folder("Deleted Messages")]).trash, "Deleted Messages");
  assert.equal(pickFolders([folder("INBOX.Deleted Items", { delimiter: "." })]).trash, "INBOX.Deleted Items");
});

test("imapflow's guess from a name is used last", () => {
  const list = [folder("Papierkorb", { specialUse: "\\Trash", specialUseSource: "name" }), folder("Gesendet", { specialUse: "\\Sent", specialUseSource: "name" })];
  assert.deepEqual(pickFolders(list), { sent: "Gesendet", trash: "Papierkorb" });
  // A real Trash folder beats a guessed one.
  assert.equal(pickFolders([...list, folder("Trash")]).trash, "Trash");
});

test("parents that cannot be opened, the Inbox, and missing folders are never picked", () => {
  const list = [folder("Sent", { flags: new Set(["\\Noselect"]) }), folder("INBOX.Sent", { delimiter: "." }), folder("Junk", { flags: new Set(["\\NonExistent"]) })];
  assert.deepEqual(pickFolders(list), { sent: "INBOX.Sent" });
  assert.deepEqual(pickFolders([folder("INBOX", { specialUse: "\\Junk", specialUseSource: "extension" })]), {});
});

test("one folder is never given two roles", () => {
  const list = [folder("Spam", { specialUse: "\\Trash", specialUseSource: "extension" })];
  assert.deepEqual(pickFolders(list), { trash: "Spam" });
});

test("a server with only an Inbox has no other folders", () => {
  assert.deepEqual(pickFolders([folder("INBOX")]), {});
});
