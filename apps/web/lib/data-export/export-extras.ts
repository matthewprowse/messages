"use client";

// The later parts of Download My Data (labels, saved views, templates and snippets, signatures, note links, linked chats, document
// cards, client cards, edited and deleted message versions), kept out of export-source.ts so that file stays about the core
// content. Each reader returns plain rows with every sealed value opened HERE, in the browser, with the person's own key. The
// build (build-export.ts) writes each to its path and reports a failure without stopping the rest.

import { FIELD } from "@messages/crypto/fields";
import { allRows } from "../contacts";
import { parseComposer } from "../composer-settings";
import { supabase } from "../supabase";
import { open, openRows } from "../vault";
import type { ExportExtra } from "./build-export";

/** A sealed JSON column read back as data; text that is not JSON is kept as it is rather than lost. */
export function jsonOrText(text: string | null | undefined): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export function browserExportExtras(): ExportExtra[] {
  return [
    {
      path: "organise/labels.json", what: "Labels",
      read: async () => {
        const [labels, onChats] = await Promise.all([
          allRows("Load labels", (from, to) => supabase.from("labels").select("id, name, color, created_at").order("id").range(from, to)),
          allRows("Load chat labels", (from, to) => supabase.from("thread_labels").select("thread_id, label_id, created_at").order("thread_id").order("label_id").range(from, to)),
        ]);
        await openRows(labels, [["name", FIELD.name]] as const);
        return [{ labels, onConversations: onChats }];
      },
    },
    {
      path: "organise/saved-views.json", what: "Saved views",
      read: async () => {
        const rows = await allRows("Load saved views", (from, to) => supabase.from("saved_views").select("id, name, view, filter, label_id, created_at").order("id").range(from, to));
        return openRows(rows, [["name", FIELD.name]] as const);
      },
    },
    {
      path: "writing/templates-and-snippets.json", what: "Templates and snippets",
      read: async () => {
        const rows = await allRows("Load templates", (from, to) => supabase.from("user_templates").select("id, kind, title, shortcut, body, position, created_at").order("id").range(from, to));
        // The same fields use-user-templates.ts seals them with.
        await openRows(rows, [["title", FIELD.writingSituation], ["shortcut", FIELD.writingSituation], ["body", FIELD.writingBody]] as const);
        return rows;
      },
    },
    {
      path: "writing/signatures.json", what: "Signatures",
      read: async () => {
        const rows = await allRows("Load signatures", (from, to) => supabase.from("account_composer").select("account_id, settings, updated_at").order("account_id").range(from, to));
        return Promise.all(rows.map(async (r) => ({ accountId: r.account_id, updatedAt: r.updated_at, ...parseComposer(await open(FIELD.writingBody, r.settings)) })));
      },
    },
    {
      path: "notes/note-links.json", what: "Note links",
      read: () => allRows("Load note links", (from, to) => supabase.from("note_links").select("id, note_id, contact_id, thread_id, event_id, created_at").order("id").range(from, to)),
    },
    {
      path: "conversations/linked-chats.json", what: "Linked chats",
      read: () => allRows("Load linked chats", (from, to) => supabase.from("thread_links").select("id, thread_a, thread_b, contact_id, status, source, created_at, decided_at").order("id").range(from, to)),
    },
    {
      path: "contacts/client-cards.json", what: "Client cards",
      read: async () => {
        const rows = await allRows("Load client cards", (from, to) => supabase.from("client_cards").select("contact_id, card, updated_at").order("contact_id").range(from, to));
        await openRows(rows, [["card", FIELD.contactSummary]] as const);
        return rows.filter((r) => r.card);
      },
    },
    {
      path: "files/document-cards.json", what: "Document cards",
      read: async () => {
        const rows = await allRows("Load document cards", (from, to) => supabase.from("attachments").select("id, message_id, filename, doc_card").not("doc_card", "is", null).order("id").range(from, to));
        await openRows(rows, [["filename", FIELD.filename], ["doc_card", FIELD.docCard]] as const);
        return rows.map((r) => ({ id: r.id, messageId: r.message_id, filename: r.filename, card: jsonOrText(r.doc_card) }));
      },
    },
    {
      path: "conversations/message-history.json", what: "Edited and deleted messages",
      read: async () => {
        const rows = await allRows("Load message history", (from, to) => supabase.from("message_versions").select("id, message_id, reason, body_text, created_at").order("id").range(from, to));
        // Sealed as the message body was when it was copied.
        return openRows(rows, [["body_text", FIELD.body]] as const);
      },
    },
  ];
}
