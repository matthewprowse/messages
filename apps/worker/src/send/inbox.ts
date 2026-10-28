// Who may send a queued reply in a conversation (step 5 of Teams, supabase/migrations/20261103100000_team_owner_features.sql).
// A reply is normally its conversation's own person's. In a shared inbox the conversation belongs to whoever connected the
// account, and a member on the inbox's access list may reply too: the database lets them queue it (an outbox policy), and
// asks again here, because the worker uses the service role and checks every row itself. It goes out from the shared
// account, never from the member's own.

/** owner: the conversation's own person. inbox: someone else, on the shared inbox's access list. nobody: no one may send this. */
export type ReplyFor = "owner" | "inbox" | "nobody";

export function replyFor(conversationOwner: string, sender: string, onInboxList: boolean): ReplyFor {
  if (conversationOwner === sender) return "owner";
  return onInboxList ? "inbox" : "nobody";
}

/** An account sends for its own person, and for a member replying in the shared inbox it belongs to. */
export function mayUseAccount(accountOwner: string, sender: string, via: ReplyFor): boolean {
  return accountOwner === sender || via === "inbox";
}
