import assert from "node:assert/strict";
import { test } from "node:test";
import { actionLabels, applyLabelChange, hidden, historyChanges, roleOf, threadPlace } from "./gmail-labels";

test("maps labels to the folder a message would be in", () => {
  assert.equal(roleOf(["INBOX", "UNREAD", "CATEGORY_UPDATES"]), "inbox");
  assert.equal(roleOf(["SENT"]), "sent");
  assert.equal(roleOf(["SENT", "INBOX"]), "sent"); // an email to yourself is still one you sent
  assert.equal(roleOf(["IMPORTANT", "Label_12"]), "archive");
});

test("hides drafts, spam and the bin", () => {
  assert.equal(hidden(["DRAFT"]), true);
  assert.equal(hidden(["SPAM", "UNREAD"]), true);
  assert.equal(hidden(["TRASH"]), true);
  assert.equal(hidden(["INBOX", "UNREAD"]), false);
});

test("folds history into the latest state per message", () => {
  const changes = historyChanges([
    { id: "1", messagesAdded: [{ message: { id: "a", threadId: "t", labelIds: ["INBOX", "UNREAD"] } }] },
    { id: "2", labelsRemoved: [{ message: { id: "a", threadId: "t", labelIds: ["INBOX"] }, labelIds: ["UNREAD"] }] },
    { id: "3", labelsRemoved: [{ message: { id: "b", threadId: "u", labelIds: ["IMPORTANT"] }, labelIds: ["INBOX"] }] },
    { id: "4", labelsAdded: [{ message: { id: "b", threadId: "u", labelIds: ["IMPORTANT", "INBOX"] }, labelIds: ["INBOX"] }] },
    { id: "5", messagesAdded: [{ message: { id: "c", threadId: "v", labelIds: ["INBOX"] } }] },
    { id: "6", messagesDeleted: [{ message: { id: "c", threadId: "v" } }] },
  ]);
  assert.deepEqual([...changes.added], [["a", ["INBOX"]]]);
  assert.deepEqual([...changes.relabelled], [["b", ["IMPORTANT", "INBOX"]]]);
  assert.deepEqual([...changes.deleted], ["c"]);
});

test("a label change without the new labels asks for them", () => {
  const changes = historyChanges([{ id: "1", labelsAdded: [{ message: { id: "a", threadId: "t" }, labelIds: ["STARRED"] }] }]);
  assert.deepEqual([...changes.relabelled], [["a", null]]);
});

test("applies an app action to stored labels", () => {
  assert.deepEqual(applyLabelChange(["INBOX", "UNREAD"], [], ["UNREAD"]), ["INBOX"]);
  assert.deepEqual(applyLabelChange(["IMPORTANT"], ["INBOX"], []), ["IMPORTANT", "INBOX"]);
  assert.deepEqual(applyLabelChange(["INBOX"], ["INBOX"], []), ["INBOX"]);
});

test("maps app actions to Gmail label changes", () => {
  assert.deepEqual(actionLabels("trash"), { add: ["TRASH"], remove: [] });
  assert.deepEqual(actionLabels("untrash"), { add: [], remove: ["TRASH"] });
  assert.deepEqual(actionLabels("spam"), { add: ["SPAM"], remove: ["INBOX"] });
  assert.deepEqual(actionLabels("unspam"), { add: ["INBOX"], remove: ["SPAM"] });
  assert.deepEqual(actionLabels("archive"), { add: [], remove: ["INBOX"] });
  assert.equal(actionLabels("delete_forever"), null);
});

test("works out where a conversation is in Gmail", () => {
  const inbound = (labels: string[], deleted = false) => ({ labels, direction: "inbound", deleted });
  const outbound = (labels: string[]) => ({ labels, direction: "outbound" });
  assert.equal(threadPlace([inbound(["INBOX", "UNREAD"]), outbound(["SENT"])]), "inbox");
  assert.equal(threadPlace([inbound(["IMPORTANT"]), outbound(["SENT"])]), "archived");
  // Your reply stays in Sent, but the conversation is in the Bin.
  assert.equal(threadPlace([inbound(["TRASH", "INBOX"]), outbound(["SENT"])]), "trash");
  assert.equal(threadPlace([outbound(["SENT", "TRASH"])]), "trash");
  assert.equal(threadPlace([inbound(["SPAM"]), inbound(["TRASH"])]), "spam");
  assert.equal(threadPlace([inbound(["SPAM"]), inbound(["INBOX"])]), "inbox");
  assert.equal(threadPlace([inbound(["TRASH"]), inbound(["IMPORTANT"])]), "archived");
  assert.equal(threadPlace([inbound([], true)]), "gone");
  assert.equal(threadPlace([]), "gone");
});
