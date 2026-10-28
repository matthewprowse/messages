"use client";

// The compliance export (supabase/migrations/20261104100000_team_after_launch.sql), from the app's side. begin_client_export
// writes the content-free log row first and lists the client's shared chats; the messages and notes of each are then read a
// page at a time while that export is open, still sealed with the team's key. They are opened HERE, in the browser, and the
// file is built here (export-file.ts), so the server never holds a readable word of it. finish_client_export records how many
// messages were read. Only Compliance, and only while strict sharing is on; the database checks all of it.

import { encryptTeamField } from "@messages/crypto";
import { addressKey } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { open, teamKeys } from "./vault";
import { htmlToText } from "./email-text";
import type { ExportChat, ExportDoc, ExportMessage, ExportNote } from "./export-file";

const PAGE = 200;
const problem = (error: { message: string } | null) => error?.message || "Something went wrong. Try again.";

export interface ExportProgress {
  chats: number;
  chatsDone: number;
  messages: number;
  messagesTotal: number;
}

interface BeganChat {
  thread_id: string;
  label: string | null;
  channel: string;
  shared_by: string;
  agent_name: string | null;
  inbox_name: string | null;
  shared_at: string;
  share_from: string | null;
  total: number;
  pending: number;
}

const readPage = (exportId: string, thread: string, afterSent: string | null, afterId: string | null) =>
  supabase.rpc("export_chat_messages", { p_export: exportId, p_thread: thread, p_after_sent: afterSent, p_after_id: afterId, p_limit: PAGE });

/** The client's own addresses and numbers, opened, as the comparison form (addressKey), so a message from them reads as their name. */
async function clientAddresses(clientId: string): Promise<Set<string>> {
  const { data } = await supabase.from("workspace_contact_identities").select("value").eq("workspace_contact_id", clientId);
  const out = new Set<string>();
  for (const r of data ?? []) {
    const value = await open(FIELD.address, r.value);
    if (value) out.add(addressKey(value));
  }
  return out;
}

/** A message's text as a person reads it: the plain text, else the text of its HTML, with a voice note's words first. */
async function textOf(row: { body_text: string | null; body_html: string | null; transcript: string | null }): Promise<string> {
  let text = ((await open(FIELD.body, row.body_text)) ?? "").trim();
  if (!text && row.body_html) text = htmlToText((await open(FIELD.html, row.body_html)) ?? "");
  const said = ((await open(FIELD.transcript, row.transcript)) ?? "").trim();
  return said ? `(Voice note) ${said}${text ? `\n\n${text}` : ""}` : text;
}

/**
 * Exports one client's work history: every shared chat with them, across agents and shared inboxes, email and WhatsApp, with
 * dates, senders and text, and the team's notes. Resolves to the document to turn into a file, or a reason. Whatever happens,
 * the export is closed afterwards with the number of messages actually read, so the log is accurate and reading stops.
 */
export async function exportClientHistory(input: {
  client: { id: string; name: string; company: string };
  workspace: string;
  exportedBy: string;
  onProgress?: (p: ExportProgress) => void;
}): Promise<{ doc: ExportDoc; messages: number } | { problem: string }> {
  const team = await teamKeys();
  if (!team) return { problem: "Your team's key is not available. Reload the page and try again." };

  const began = await supabase.rpc("begin_client_export", { p_client: input.client.id, p_label: await encryptTeamField(team, FIELD.name, input.client.name) });
  if (began.error || !began.data) return { problem: problem(began.error) };
  const { export_id: exportId, chats: listed } = began.data as unknown as { export_id: string; chats: BeganChat[] };

  const progress: ExportProgress = { chats: listed.length, chatsDone: 0, messages: 0, messagesTotal: listed.reduce((n, c) => n + Number(c.total), 0) };
  input.onProgress?.({ ...progress });
  let read = 0;
  try {
    const addresses = await clientAddresses(input.client.id);
    const chats: ExportChat[] = [];
    for (const c of listed) {
      const inbox = c.shared_by === "account";
      const agent = c.agent_name ?? "Someone";
      const side = inbox ? `${c.inbox_name ?? "Shared inbox"} (shared inbox)` : agent;
      const messages: ExportMessage[] = [];
      let afterSent: string | null = null;
      let afterId: string | null = null;
      for (;;) {
        const page = await readPage(exportId, c.thread_id, afterSent, afterId);
        if (page.error) throw new Error(problem(page.error));
        const rows = page.data ?? [];
        for (const r of rows) {
          const outbound = r.direction === "outbound";
          const sender = ((await open(FIELD.address, r.sender_address)) ?? "").trim();
          const to = outbound ? (await Promise.all((r.to_addresses ?? []).map((a) => open(FIELD.address, a)))).filter((a): a is string => !!a) : [side];
          const files = ((r.files ?? []) as string[]).length ? (await Promise.all((r.files as string[]).map((f) => open(FIELD.filename, f)))).filter((f): f is string => !!f) : [];
          messages.push({
            id: r.id,
            sentAt: r.sent_at,
            direction: outbound ? "outbound" : "inbound",
            from: outbound ? side : sender && addresses.has(addressKey(sender)) ? input.client.name : sender || "Unknown sender",
            to,
            subject: ((await open(FIELD.subject, r.subject)) ?? "").trim(),
            text: await textOf(r),
            quoted: ((await open(FIELD.quote, r.quoted_text)) ?? "").trim() || null,
            files,
          });
        }
        read += rows.length;
        progress.messages = read;
        input.onProgress?.({ ...progress });
        if (rows.length < PAGE) break;
        const last = rows[rows.length - 1];
        afterSent = last.sent_at;
        afterId = last.id;
      }
      const noted = await supabase.rpc("export_chat_notes", { p_export: exportId, p_thread: c.thread_id });
      if (noted.error) throw new Error(problem(noted.error));
      const notes: ExportNote[] = await Promise.all((noted.data ?? []).map(async (n): Promise<ExportNote> => ({ author: n.user_name ?? "A former member", at: n.created_at, text: ((await open(FIELD.note, n.body)) ?? "").trim() })));
      chats.push({
        threadId: c.thread_id,
        label: ((await open(FIELD.name, c.label)) ?? "").trim(),
        channel: c.channel,
        kind: inbox ? "shared_inbox" : "agent",
        agent,
        inbox: inbox ? c.inbox_name : null,
        sharedAt: c.shared_at,
        shareFrom: c.share_from,
        notYetShared: Number(c.pending),
        messages,
        notes,
      });
      progress.chatsDone++;
      input.onProgress?.({ ...progress });
    }
    const finished = await supabase.rpc("finish_client_export", { p_export: exportId, p_messages: read });
    if (finished.error) throw new Error(problem(finished.error));
    return { doc: { generatedAt: new Date().toISOString(), workspace: input.workspace, exportedBy: input.exportedBy, client: { name: input.client.name, company: input.client.company }, chats }, messages: read };
  } catch (err) {
    // Close it with what was read, so the log says so and the open export stops giving anything.
    await supabase.rpc("finish_client_export", { p_export: exportId, p_messages: read });
    return { problem: err instanceof Error && err.message ? err.message : "The export could not be finished. Try again." };
  }
}

/** Turns a built file into a download. */
export function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface ExportLogRow {
  id: string;
  userName: string;
  client: string;
  chats: number;
  /** null while an export is open or was never finished. */
  messages: number | null;
  startedAt: string;
  finished: boolean;
}

/** The log of exports: for an owner or admin all of them, for Compliance their own. Client names are opened with the team's key. */
export function useExportLog(enabled: boolean) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [rows, setRows] = useState<ExportLogRow[] | null | undefined>(undefined);
  const load = useCallback(async () => {
    if (!userId || !enabled) return;
    const { data, error } = await supabase.rpc("compliance_export_log");
    if (error) return setRows(null);
    setRows(await Promise.all((data ?? []).map(async (r): Promise<ExportLogRow> => ({
      id: r.id,
      userName: r.user_name ?? "Someone",
      client: (await open(FIELD.name, r.client_label)) || "Client",
      chats: r.chats,
      messages: r.messages,
      startedAt: r.started_at,
      finished: !!r.finished_at,
    }))));
  }, [userId, enabled]);
  useEffect(() => { void load(); }, [load]);
  return { rows, reload: load };
}

/** The days the agent's own chats were part of an export, for What You Share: thread id to the days, newest first. */
export function useExportedChats() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [days, setDays] = useState<Map<string, string[]> | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void supabase.rpc("my_exported_chats").then(({ data, error }) => {
      if (error || !alive) return;
      const out = new Map<string, string[]>();
      for (const r of data ?? []) out.set(r.thread_id, [...(out.get(r.thread_id) ?? []), r.exported_on]);
      setDays(out);
    });
    return () => { alive = false; };
  }, [userId]);
  return days;
}
