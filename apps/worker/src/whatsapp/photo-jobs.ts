// Which chats are due a profile picture lookup. Pure: the connector's photo pass (whatsapp/photos.ts) turns each job
// into a fetch and a save.

export interface PhotoThread {
  id: string;
  is_group: boolean;
  provider_thread_id: string;
  avatar_updated_at: string | null;
  thread_participants: { contact_id: string; contacts: { avatar_source: string | null; avatar_updated_at: string | null } | null }[];
}

export type PhotoJob =
  | { kind: "group"; jid: string; threadId: string }
  | { kind: "contact"; jid: string; contactId: string; avatarSource: string | null };

/** Groups never looked up or stale; one-to-one chats whose contact picture is WhatsApp's or unset, once per contact. */
export function photoJobsDue(threads: PhotoThread[], stale: string): PhotoJob[] {
  const due = (at: string | null) => !at || at < stale;
  const jobs: PhotoJob[] = [];
  const seen = new Set<string>();
  for (const t of threads) {
    if (t.is_group) {
      if (due(t.avatar_updated_at)) jobs.push({ kind: "group", jid: t.provider_thread_id, threadId: t.id });
      continue;
    }
    const p = t.thread_participants[0];
    if (!p?.contacts || seen.has(p.contact_id)) continue;
    seen.add(p.contact_id);
    const source = p.contacts.avatar_source;
    if ((source === null || source === "whatsapp") && due(p.contacts.avatar_updated_at)) {
      jobs.push({ kind: "contact", jid: t.provider_thread_id, contactId: p.contact_id, avatarSource: source });
    }
  }
  return jobs;
}
