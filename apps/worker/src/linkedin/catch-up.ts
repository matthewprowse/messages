// Which conversations a LinkedIn catch-up reads. Pure: the connector (connectors/linkedin.ts) does the reading and decides
// from its failure count whether the sync token may move.

import { skipConversation } from "./mapping";
import type { LinkedInConversation } from "./helper";

/**
 * The conversations to read, newest activity first. The first run (live false) reads only the latest `firstRunLimit`,
 * as an import. Every later run reads all that changed: the sync token moves past them all, so a conversation left out
 * here would never be imported.
 */
export function catchUpTargets(conversations: LinkedInConversation[], meId: string, live: boolean, firstRunLimit: number): LinkedInConversation[] {
  const wanted = conversations.filter((c) => !skipConversation(c, meId)).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return live ? wanted : wanted.slice(0, firstRunLimit);
}

/** The sync token is saved only when nothing failed to store, so the next catch-up reads the same changes again. */
export function mayAdvanceToken(failures: number): boolean {
  return failures === 0;
}
