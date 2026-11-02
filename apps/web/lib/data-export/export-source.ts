"use client";

// The real ExportSource (build-export.ts): reads the signed-in person's own rows through the browser's Supabase client, so
// row-level security keeps it to them, and opens every sealed value HERE with their key. The server never sees readable text
// and no key leaves the browser. Reads are paged and use the app's own loaders, so what is exported is what the app shows.

import { decryptBytes, isSealedBytes } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { allRows } from "../contacts";
import { supabase } from "../supabase";
import { openRows, userKeys } from "../vault";
import { openTasks, openThreads } from "../open-rows";
import { THREAD_WITH_IDS } from "../data/columns";
import { threadWithIds } from "../data/map-thread";
import { loadContacts } from "../data/load-contacts";
import { loadThreadMessages } from "../data/load-messages";
import { loadSmall, myId } from "../data/load-small";
import { loadEvents } from "../calendar";
import { loadNoteBodies, loadNotes } from "../notes";
import { mapTask, TASK_COLUMNS } from "../tasks";
import type { Contact } from "../types";
import type { ExportSource, SourceFile, SourceMessage, SourceThread } from "./build-export";

const CHANNEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn", instagram: "Instagram", teams: "Teams", zoom: "Zoom", google_chat: "Google Chat" };
const YEAR_MS = 365 * 86_400_000;
const BODY_CHUNK = 40; // notes whose text is fetched in one request

/** What a stored file needs to be fetched and opened. */
interface Stored { bucket: string; path: string; sealed: boolean; field: typeof FIELD.attachmentData | typeof FIELD.noteFileData }

export function browserExportSource(): ExportSource {
  let contacts: Promise<Contact[]> | null = null;
  const everyone = () => (contacts ??= loadContacts());
  const stored = new Map<string, Stored>();

  return {
    async threads() {
      const [me, people] = await Promise.all([myId(), everyone()]);
      const names = new Map(people.map((c) => [c.id, c.name]));
      const rows = await allRows("Load conversations", (from, to) => supabase.from("threads").select(THREAD_WITH_IDS).eq("user_id", me).order("id").range(from, to));
      await openThreads(rows);
      return rows.map((row): SourceThread => {
        const t = threadWithIds(row);
        const who = t.participantIds.map((id) => names.get(id)).filter(Boolean).join(", ");
        return { id: t.id, title: t.groupName || who || t.subject || t.fallbackName || "Conversation", channel: CHANNEL[t.channel] ?? t.channel, status: t.status, lastMessageAt: t.lastMessageAt };
      });
    },

    async messages(thread) {
      const [page, people] = await Promise.all([loadThreadMessages(thread.id, { from: "1970-01-01T00:00:00.000Z" }), everyone()]);
      const names = new Map(people.map((c) => [c.id, c.name]));
      return page.messages.map((m): SourceMessage => ({
        id: m.id,
        sentAt: m.sentAt,
        direction: m.from === "me" ? "out" : "in",
        who: m.from === "me" ? "You" : names.get(m.from) ?? m.address ?? "Unknown",
        address: m.address,
        text: m.body,
        quoted: m.quoted,
        transcript: m.transcript,
        files: (m.attachments ?? []).map((a) => a.name),
      }));
    },

    contacts: async () => (await everyone()).map((c) => ({ name: c.name, emails: c.emails, phones: c.phones, company: c.company, role: c.role })),

    async notes() {
      const list = await loadNotes();
      const out = [];
      for (let i = 0; i < list.length; i += BODY_CHUNK) {
        const slice = list.slice(i, i + BODY_CHUNK);
        const bodies = await loadNoteBodies(slice.map((n) => n.id));
        // A note whose text cannot be opened is skipped here and reported by the caller as a missing note, never exported empty.
        for (const n of slice) {
          const body = bodies.get(n.id);
          if (body) out.push({ id: n.id, title: n.title, body: body.body, pinned: n.pinned, createdAt: n.createdAt, updatedAt: n.updatedAt });
          else throw Object.assign(new Error("note could not be opened"), { code: "NOTE_OPEN" });
        }
      }
      return out;
    },

    async tasks() {
      const rows = await allRows("Load tasks", (from, to) => supabase.from("tasks").select(TASK_COLUMNS).order("id").range(from, to));
      await openTasks(rows);
      return rows.map(mapTask);
    },

    async events() {
      const now = Date.now();
      const out = [];
      // Ten years back and three ahead, a year at a time, so no window runs into loadEvents' page limit.
      for (let from = now - 10 * YEAR_MS; from < now + 3 * YEAR_MS; from += YEAR_MS) {
        for (const e of await loadEvents(new Date(from), new Date(from + YEAR_MS), { details: true })) {
          out.push({ id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay, location: e.location, description: e.description, recurrence: e.recurrence, calendar: e.calendarName });
        }
      }
      // A year window reaches a day either side, so an event on the seam can come twice.
      return [...new Map(out.map((e) => [e.id, e])).values()];
    },

    async settings() {
      const [small, session] = await Promise.all([loadSmall(), supabase.auth.getSession()]);
      return {
        signedInAs: session.data.session?.user.email ?? null,
        profile: small.profile,
        connectedAccounts: small.accounts.map((a) => ({ provider: a.provider, name: a.nickname || a.label, address: a.detail, status: a.status })),
        priorityRules: small.rules,
        writingExamples: small.writingExamples,
        unsubscribedSenders: small.unsubscribes.map((u) => ({ sender: u.sender, status: u.status })),
      };
    },

    async files() {
      const me = await myId();
      const [att, notes] = await Promise.all([
        allRows("Load files", (from, to) => supabase.from("attachments").select("id, filename, storage_path, sealed, size_bytes").eq("user_id", me).not("storage_path", "is", null).order("id").range(from, to)),
        allRows("Load note files", (from, to) => supabase.from("note_attachments").select("id, name, storage_path, size_bytes").order("id").range(from, to)),
      ]);
      await Promise.all([openRows(att, [["filename", FIELD.filename]]), openRows(notes, [["name", FIELD.noteFile]])]);
      const out: SourceFile[] = [];
      const seen = new Set<string>();
      for (const a of att) {
        // One stored object can serve several rows (same content in one account): it is exported once.
        if (!a.storage_path || seen.has(a.storage_path)) continue;
        seen.add(a.storage_path);
        stored.set(a.id, { bucket: "attachments", path: a.storage_path, sealed: a.sealed, field: FIELD.attachmentData });
        out.push({ id: a.id, name: a.filename || "File", kind: "attachment", bytes: Number(a.size_bytes ?? 0) });
      }
      for (const n of notes) {
        stored.set(n.id, { bucket: "attachments", path: n.storage_path, sealed: true, field: FIELD.noteFileData });
        out.push({ id: n.id, name: n.name || "File", kind: "note", bytes: Number(n.size_bytes ?? 0) });
      }
      return out;
    },

    async file(f) {
      const s = stored.get(f.id);
      if (!s) return null;
      const { data, error } = await supabase.storage.from(s.bucket).download(s.path);
      if (error || !data) return null;
      const bytes = new Uint8Array(await data.arrayBuffer());
      // A file stored before sealing began has no header and is already readable.
      return isSealedBytes(bytes) ? decryptBytes(await userKeys(), s.field, bytes) : bytes;
    },
  };
}
