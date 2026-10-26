import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GraphApiError, GraphClient } from "../microsoft/client";
import { MicrosoftAuthError } from "../microsoft/oauth";
import {
  ADMIN_APPROVAL,
  DELETED,
  changedChats,
  inboundRead,
  isGroupChat,
  markChatRead,
  memberOf,
  messageContent,
  postReply,
  reactionsOf,
  sendFailure,
  storedMessageId,
  teamsAccessProblem,
  teamsHtml,
  type GraphChat,
  type GraphChatMessage,
} from "./chat";

// Shaped like Graph's own responses in the chatMessage and chat reference pages.
const message = (over: Partial<GraphChatMessage> = {}): GraphChatMessage => ({
  id: "1616964509832",
  messageType: "message",
  createdDateTime: "2026-10-26T08:15:09.832Z",
  lastModifiedDateTime: "2026-10-26T08:15:09.832Z",
  lastEditedDateTime: null,
  deletedDateTime: null,
  from: { user: { id: "8ea0e38b-efb3-4757-924a-5f94061cf8c2", displayName: "Thabo Nkosi", userIdentityType: "aadUser" }, application: null },
  body: { contentType: "html", content: "<p>Morning! Can we move the <b>signing</b> to Friday?</p>" },
  attachments: [],
  reactions: [],
  ...over,
});

test("a chat message's HTML becomes text and marks, as email's does", () => {
  const c = messageContent(message())!;
  assert.equal(c.text, "Morning! Can we move the signing to Friday?");
  assert.deepEqual(c.marks, [{ text: "signing", mark: "bold" }]);
  assert.equal(c.preview, "Morning! Can we move the signing to Friday?");
  assert.equal(c.deleted, false);
  assert.equal(c.quoted, null);
});

test("plain text messages, line breaks, mentions and emoji survive", () => {
  assert.equal(messageContent(message({ body: { contentType: "text", content: " Thanks \n" } }))!.text, "Thanks");
  const html = '<p>Hi <at id="0">Lerato Dlamini</at>,</p><p>see you then <emoji id="1f44d_thumbsup" alt="👍" title="Thumbs up"></emoji></p>';
  assert.equal(messageContent(message({ body: { contentType: "html", content: html } }))!.text, "Hi Lerato Dlamini,\nsee you then 👍");
  const old = '<div>ok <img alt="😀" itemtype="http://schema.skype.com/Emoji" src="https://statics.teams.cdn.office.net/x.png"></div>';
  assert.equal(messageContent(message({ body: { contentType: "html", content: old } }))!.text, "ok 😀");
});

test("system events and empty messages are not stored", () => {
  assert.equal(messageContent(message({ messageType: "systemEventMessage", body: { contentType: "html", content: "<systemEventMessage/>" } })), null);
  assert.equal(messageContent(message({ body: { contentType: "html", content: "<p> </p>" } })), null);
});

test("a deleted message says so, and an edited one is marked", () => {
  const gone = messageContent(message({ deletedDateTime: "2026-10-26T09:00:00Z", body: { contentType: "html", content: "" } }))!;
  assert.equal(gone.text, DELETED);
  assert.equal(gone.deleted, true);
  assert.equal(messageContent(message({ lastEditedDateTime: "2026-10-26T09:00:00Z" }))!.edited, true);
});

test("shared files, images and cards are named", () => {
  const file = messageContent(message({
    body: { contentType: "html", content: '<p>Here it is</p><attachment id="153fa47d18c54a0"></attachment>' },
    attachments: [{ id: "153fa47d18c54a0", contentType: "reference", contentUrl: "https://contoso.sharepoint.com/x.pdf", name: "Offer to Purchase.pdf" }],
  }))!;
  assert.equal(file.text, "Here it is\nFile: Offer to Purchase.pdf");
  const photo = messageContent(message({ body: { contentType: "html", content: '<p><img src="https://graph.microsoft.com/v1.0/chats/19:x/messages/1/hostedContents/abc/$value" alt="image"></p>' } }))!;
  assert.equal(photo.text, "Photo");
  const card = messageContent(message({
    body: { contentType: "html", content: '<attachment id="card1"></attachment>' },
    attachments: [{ id: "card1", contentType: "application/vnd.microsoft.card.adaptive", content: "{}" }],
  }))!;
  assert.equal(card.text, "Card");
});

test("a reply keeps the message it quotes", () => {
  const reply = messageContent(message({
    body: { contentType: "html", content: '<attachment id="1616964000000"></attachment><p>Yes, Friday works.</p>' },
    attachments: [{
      id: "1616964000000",
      contentType: "messageReference",
      content: JSON.stringify({ messageId: "1616964000000", messagePreview: "Can we do Friday?", messageSender: { user: { id: "u1", displayName: "Adele Vance", userIdentityType: "aadUser" } } }),
    }],
  }))!;
  assert.equal(reply.text, "Yes, Friday works.");
  assert.deepEqual(reply.quoted, { id: "1616964000000", authorId: "u1", author: "Adele Vance", text: "Can we do Friday?" });
  const broken = messageContent(message({ attachments: [{ id: "x", contentType: "messageReference", content: "{not json" }] }))!;
  assert.equal(broken.quoted, null);
});

test("reactions by name and by emoji", () => {
  const msg = message({
    reactions: [
      { reactionType: "like", user: { user: { id: "u1" } } },
      { reactionType: "🎉", displayName: "Party popper", user: { user: { id: "u2" } } },
      { reactionType: "custom-thing", user: { user: { id: "u3" } } },
      { reactionType: "heart", user: { user: null } },
    ],
  });
  assert.deepEqual(reactionsOf(msg), [{ userId: "u1", emoji: "👍" }, { userId: "u2", emoji: "🎉" }]);
});

test("members are kept by Entra ID with a usable address", () => {
  assert.deepEqual(memberOf({ id: "m1", userId: "u1", displayName: " Adele Vance ", email: "Adele.Vance@Contoso.com", tenantId: "t1" }), {
    userId: "u1", name: "Adele Vance", email: "adele.vance@contoso.com", tenantId: "t1",
  });
  assert.equal(memberOf({ id: "m2", userId: "u2", email: "" })!.email, null);
  assert.equal(memberOf({ id: "m3", displayName: "Guest" }), null);
});

test("message IDs are scoped to their chat", () => {
  assert.equal(storedMessageId("idx", "1616964509832"), "teams:idx:1616964509832");
  assert.notEqual(storedMessageId("a", "1"), storedMessageId("b", "1"));
});

const chat = (id: string, last: string | null, over: Partial<GraphChat> = {}): GraphChat => ({
  id, chatType: "oneOnOne", topic: null, lastMessagePreview: last ? { id: "m", createdDateTime: last } : null, ...over,
});

test("only chats with new messages are read, and the next page only when this one was all new", () => {
  const since = Date.parse("2026-10-26T08:00:00Z");
  const page = [chat("a", "2026-10-26T09:00:00Z"), chat("b", "2026-10-26T08:30:00Z"), chat("c", "2026-10-26T07:00:00Z"), chat("d", null)];
  assert.deepEqual(changedChats(page, since, true), { changed: [page[0], page[1]], more: false });
  assert.deepEqual(changedChats(page.slice(0, 2), since, true).more, true);
  assert.deepEqual(changedChats(page.slice(0, 2), since, false).more, false);
  assert.deepEqual(changedChats([], since, true), { changed: [], more: false });
});

test("group and meeting chats are groups", () => {
  assert.equal(isGroupChat(chat("a", null)), false);
  assert.equal(isGroupChat(chat("a", null, { chatType: "group" })), true);
  assert.equal(isGroupChat(chat("a", null, { chatType: "meeting" })), true);
});

test("Teams' read point decides what is unread", () => {
  const read = chat("a", null, { viewpoint: { isHidden: false, lastMessageReadDateTime: "2026-10-26T09:00:00Z" } });
  assert.equal(inboundRead("2026-10-26T08:59:00Z", read, false), true);
  assert.equal(inboundRead("2026-10-26T09:01:00Z", read, true), false);
  assert.equal(inboundRead("2026-10-26T09:01:00Z", chat("b", null), true), true);
  assert.equal(inboundRead("2026-10-26T09:01:00Z", chat("b", null), false), false);
});

test("a reply is escaped HTML with its lines kept", () => {
  assert.equal(teamsHtml("Hi <Thabo> & \"team\"\nSee you\r\nat 10\n"), "Hi &lt;Thabo&gt; &amp; &quot;team&quot;<br>See you<br>at 10");
});

test("a reply is posted to the chat's messages", async () => {
  const calls: { url: string; init: unknown }[] = [];
  const client = { request: async <T>(url: string, init?: unknown) => { calls.push({ url, init }); return { id: "1700000000000" } as T; } };
  const sent = await postReply(client, "19:abc_def@unq.gbl.spaces", "Friday is fine");
  assert.equal(sent.id, "1700000000000");
  assert.equal(calls[0].url, "/chats/19%3Aabc_def%40unq.gbl.spaces/messages");
  assert.deepEqual(calls[0].init, { method: "POST", body: { body: { contentType: "html", content: "Friday is fine" } }, timeoutMs: 60_000 });

  await markChatRead(client, "19:abc@thread.v2", { userId: "u1", tenantId: "t1" });
  assert.equal(calls[1].url, "/chats/19%3Aabc%40thread.v2/markChatReadForUser");
  assert.deepEqual(calls[1].init, { method: "POST", body: { user: { id: "u1", tenantId: "t1" } } });
});

test("a failed reply says whether it may have gone", () => {
  assert.match(sendFailure(new MicrosoftAuthError("invalid_grant"), false), /sign-in expired/);
  assert.match(sendFailure(new GraphApiError(403, "Forbidden"), true), /no longer be in this chat/);
  assert.match(sendFailure(new GraphApiError(404, "NotFound"), true), /no longer exists/);
  assert.match(sendFailure(new GraphApiError(502, null), true), /may have been sent/);
  assert.match(sendFailure(new GraphApiError(400, "BadRequest"), true), /could not be sent/);
  assert.match(sendFailure(Object.assign(new Error("timeout"), { code: "ABORT_ERR" }), true), /may have been sent/);
  assert.match(sendFailure(new Error("before"), false), /could not be sent/);
});

test("admin consent and a refused chat list stop the connector with a reason", () => {
  assert.equal(teamsAccessProblem(new MicrosoftAuthError("consent_required"), false), ADMIN_APPROVAL);
  assert.match(teamsAccessProblem(new GraphApiError(403, "Forbidden"), true)!, /IT admin/);
  assert.equal(teamsAccessProblem(new GraphApiError(403, "Forbidden"), false), null);
  assert.equal(teamsAccessProblem(new GraphApiError(503, null), true), null);
  assert.equal(teamsAccessProblem(new Error("network"), true), null);
});

// GraphClient against a stand-in for Microsoft: the token endpoint, then Graph itself.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeMicrosoft(graph: (url: URL, init: RequestInit) => Response) {
  const seen: { url: URL; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname === "login.microsoftonline.com") return Response.json({ access_token: "token", expires_in: 3600 });
    seen.push({ url, init });
    return graph(url, init);
  }) as typeof fetch;
  return seen;
}

test("the chat list waits out throttling for as long as Retry-After says", async () => {
  let calls = 0;
  const seen = fakeMicrosoft(() => (++calls === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "0" } }) : Response.json({ value: [chat("a", "2026-10-26T09:00:00Z")] })));
  const client = new GraphClient({ clientId: "c", clientSecret: "", refreshToken: "r" });
  const page = await client.request<{ value: GraphChat[] }>("/me/chats", { query: { $expand: "lastMessagePreview", $orderby: "lastMessagePreview/createdDateTime desc", $top: 50 } });
  assert.equal(page.value[0].id, "a");
  assert.equal(seen.length, 2);
  assert.equal(seen[1].url.pathname, "/v1.0/me/chats");
  assert.equal(seen[1].url.searchParams.get("$orderby"), "lastMessagePreview/createdDateTime desc");
});

test("a reply goes to Graph as JSON with the access token", async () => {
  const seen = fakeMicrosoft(() => Response.json({ id: "1700000000001", messageType: "message" }, { status: 201 }));
  const client = new GraphClient({ clientId: "c", clientSecret: "", refreshToken: "r" });
  const sent = await postReply(client, "19:abc@thread.v2", "On my way");
  assert.equal(sent.id, "1700000000001");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.method, "POST");
  assert.equal(decodeURIComponent(seen[0].url.pathname), "/v1.0/chats/19:abc@thread.v2/messages");
  assert.equal((seen[0].init.headers as Record<string, string>).authorization, "Bearer token");
  assert.deepEqual(JSON.parse(seen[0].init.body as string), { body: { contentType: "html", content: "On my way" } });
});

test("a refused reply is not sent twice", async () => {
  const seen = fakeMicrosoft(() => Response.json({ error: { code: "Forbidden" } }, { status: 403 }));
  const client = new GraphClient({ clientId: "c", clientSecret: "", refreshToken: "r" });
  await assert.rejects(postReply(client, "19:abc@thread.v2", "Hello"), (err) => err instanceof GraphApiError && err.status === 403);
  assert.equal(seen.length, 1);
});
