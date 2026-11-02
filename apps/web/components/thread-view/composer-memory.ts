// What the reply box remembers for as long as the app is open, shared by every conversation's composer.

/** What you typed in each conversation, so leaving it and coming back keeps it. */
export const typedText = new Map<string, string>();
/** What the reply box held when you last asked the AI for something there, for Undo. */
export const beforeAsk = new Map<string, { text: string; replacing?: string }>();
// Whose they are: another person signing in on this tab starts with neither.
let remembersFor: string | null | undefined;

/** Called with the signed-in user's id; a different user than last time starts with an empty memory. */
export function forgetForOtherUser(authUser: string | null) {
  if (remembersFor !== undefined && remembersFor !== authUser) { typedText.clear(); beforeAsk.clear(); }
  remembersFor = authUser;
}
