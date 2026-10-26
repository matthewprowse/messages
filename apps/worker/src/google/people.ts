import { GoogleApiError, type GoogleClient } from "./client";

// Names and email addresses for Google user IDs (the "users/{id}" of Meet participants and Chat senders),
// from the People API. It answers for people in your Google contacts (contacts.readonly, part of the Gmail
// sign-in) and, in a Workspace, for colleagues whose profile your domain shares. Anyone else stays unnamed.

const BATCH = "https://people.googleapis.com/v1/people:batchGet";
/** The most people one batchGet takes. */
const PER_BATCH = 200;

export interface PersonInfo {
  name: string | null;
  email: string | null;
}

interface BatchResponse {
  responses?: {
    requestedResourceName?: string;
    person?: {
      names?: { displayName?: string; metadata?: { primary?: boolean } }[];
      emailAddresses?: { value?: string; metadata?: { primary?: boolean } }[];
    };
  }[];
}

/** What batchGet said about each user ID asked for. Ones it had nothing on are left out. */
export function peopleFromBatch(response: BatchResponse): Map<string, PersonInfo> {
  const found = new Map<string, PersonInfo>();
  for (const r of response.responses ?? []) {
    const id = r.requestedResourceName?.match(/^people\/(.+)$/)?.[1];
    if (!id || !r.person) continue;
    const name = (r.person.names?.find((n) => n.metadata?.primary) ?? r.person.names?.[0])?.displayName?.trim() || null;
    const email = (r.person.emailAddresses?.find((e) => e.metadata?.primary) ?? r.person.emailAddresses?.[0])?.value?.trim().toLowerCase() || null;
    if (name || email) found.set(id, { name, email });
  }
  return found;
}

/**
 * Looks people up once per session and remembers them, including who could not be found. A sign-in that may
 * not use the People API (403) turns lookups off for the session rather than asking again for every message.
 */
export class PeopleLookup {
  private readonly known = new Map<string, PersonInfo | null>();
  private off = false;

  constructor(private readonly client: GoogleClient) {}

  async find(userIds: Iterable<string>): Promise<Map<string, PersonInfo>> {
    const ids = [...new Set(userIds)];
    const wanted = ids.filter((id) => !this.known.has(id));
    for (let i = 0; i < wanted.length && !this.off; i += PER_BATCH) {
      const batch = wanted.slice(i, i + PER_BATCH);
      try {
        const found = peopleFromBatch(
          await this.client.request<BatchResponse>(BATCH, { query: { resourceNames: batch.map((id) => `people/${id}`), personFields: "names,emailAddresses" } }),
        );
        for (const id of batch) this.known.set(id, found.get(id) ?? null);
      } catch (err) {
        if (err instanceof GoogleApiError && (err.status === 403 || err.status === 400)) this.off = true;
        else throw err;
      }
    }
    const out = new Map<string, PersonInfo>();
    for (const id of ids) {
      const info = this.known.get(id);
      if (info) out.set(id, info);
    }
    return out;
  }
}
