// The file a compliance export produces (docs/PLAN.md, Teams): one team client's work history, built in the browser from text
// the browser has already opened with the team's key, so nothing readable ever goes to the server. A readable HTML document that
// prints cleanly (Print, Save as PDF) and a JSON copy with the same content. This file only formats: it reads nothing and
// sends nothing, which is why it is kept apart from the code that fetches and opens the text (compliance-export.ts).

export interface ExportMessage {
  id: string;
  /** ISO 8601, UTC. */
  sentAt: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string[];
  subject: string;
  text: string;
  /** What the message quotes (a WhatsApp reply). */
  quoted: string | null;
  /** Attachment names, never the files. */
  files: string[];
}

export interface ExportNote {
  author: string;
  at: string;
  text: string;
}

export interface ExportChat {
  threadId: string;
  label: string;
  channel: string;
  /** "agent" for an agent's own work chat, "shared_inbox" for a chat of a shared inbox. */
  kind: "agent" | "shared_inbox";
  agent: string;
  inbox: string | null;
  sharedAt: string;
  /** Where the shared history starts. null is the whole history. */
  shareFrom: string | null;
  /** Messages the team's copy holds that were not yet shared when the export ran, so they are not in it. */
  notYetShared: number;
  messages: ExportMessage[];
  notes: ExportNote[];
}

export interface ExportDoc {
  generatedAt: string;
  workspace: string;
  exportedBy: string;
  client: { name: string; company: string };
  chats: ExportChat[];
}

export const CHANNEL_NAME: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn", instagram: "Instagram", teams: "Teams", zoom: "Zoom", google_chat: "Google Chat" };

const SCOPE = "Work chats only, from each chat's Share From date. Personal chats and anything shared before that date are not included. Attachments are listed by name. Internal notes are included.";

export function totals(doc: ExportDoc) {
  return {
    chats: doc.chats.length,
    messages: doc.chats.reduce((n, c) => n + c.messages.length, 0),
    notes: doc.chats.reduce((n, c) => n + c.notes.length, 0),
  };
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A moment as people write it on a record: the date, the time and the zone. */
export function stamp(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short" });
  return `${date}, ${time}`;
}

const dayOnly = (iso: string, timeZone?: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 14px/1.55 system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 32px; max-width: 820px; margin-inline: auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 0 0 4px; }
  h3 { font-size: 13px; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
  .muted { color: #555; }
  .meta { color: #555; font-size: 12.5px; }
  table.facts { border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  table.facts td { padding: 2px 16px 2px 0; vertical-align: top; }
  table.facts td:first-child { color: #555; white-space: nowrap; }
  .scope { border: 1px solid #ccc; border-radius: 6px; padding: 10px 12px; font-size: 13px; margin: 16px 0 28px; }
  section.chat { margin: 0 0 36px; }
  section.chat + section.chat { border-top: 2px solid #111; padding-top: 28px; }
  article.m { border-top: 1px solid #ddd; padding: 10px 0; break-inside: avoid; }
  article.m header { font-size: 12.5px; color: #555; margin-bottom: 4px; }
  article.m header strong { color: #111; }
  .dir { display: inline-block; font-size: 11px; border: 1px solid #999; border-radius: 3px; padding: 0 5px; margin-left: 6px; color: #333; }
  .subject { font-weight: 600; margin-bottom: 2px; }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
  .quote { border-left: 3px solid #bbb; padding-left: 10px; color: #444; margin: 4px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .files { font-size: 12.5px; color: #333; margin-top: 4px; }
  .note { border: 1px dashed #888; border-radius: 6px; padding: 8px 10px; margin: 8px 0; break-inside: avoid; }
  .warn { border: 1px solid #b45309; border-radius: 6px; padding: 8px 10px; margin: 8px 0; font-size: 13px; }
  footer { margin-top: 40px; border-top: 1px solid #ccc; padding-top: 12px; font-size: 12px; color: #555; }
  @media print { body { padding: 0; max-width: none; } section.chat { break-before: auto; } h2 { break-after: avoid; } }
`;

/** A readable HTML document of the whole export. Everything that came from a message or a note is escaped. */
export function buildExportHtml(doc: ExportDoc, timeZone?: string): string {
  const t = totals(doc);
  const when = (iso: string) => escape(stamp(iso, timeZone));
  const chats = doc.chats.map((c) => {
    const where = c.kind === "shared_inbox" ? `Shared inbox ${c.inbox ?? ""}`.trim() : `Agent ${c.agent}`;
    const messages = c.messages.map((m) => `
    <article class="m">
      <header><strong>${escape(m.from)}</strong>${m.to.length ? ` to ${escape(m.to.join(", "))}` : ""}<span class="dir">${m.direction === "inbound" ? "Received" : "Sent"}</span> &middot; ${when(m.sentAt)}</header>
      ${m.subject ? `<div class="subject">${escape(m.subject)}</div>` : ""}
      ${m.quoted ? `<div class="quote">${escape(m.quoted)}</div>` : ""}
      <p class="text">${escape(m.text || "(no text)")}</p>
      ${m.files.length ? `<div class="files">Attachments: ${escape(m.files.join(", "))}</div>` : ""}
    </article>`).join("");
    const notes = c.notes.length
      ? `<h3>Internal Notes</h3>${c.notes.map((n) => `<div class="note"><div class="meta">${escape(n.author)} &middot; ${when(n.at)}</div><p class="text">${escape(n.text)}</p></div>`).join("")}`
      : "";
    return `
  <section class="chat">
    <h2>${escape(c.label || "Chat")}</h2>
    <div class="meta">${escape(CHANNEL_NAME[c.channel] ?? c.channel)} &middot; ${escape(where)} &middot; Shared ${escape(dayOnly(c.sharedAt, timeZone))} &middot; ${c.shareFrom ? `History from ${escape(dayOnly(c.shareFrom, timeZone))}` : "Whole history"} &middot; ${c.messages.length} ${c.messages.length === 1 ? "message" : "messages"}</div>
    ${c.notYetShared ? `<div class="warn">${c.notYetShared} ${c.notYetShared === 1 ? "message was" : "messages were"} still being shared when this export ran and ${c.notYetShared === 1 ? "is" : "are"} not included. Export again once sharing has finished.</div>` : ""}
    <h3>Messages</h3>
    ${messages || '<p class="muted">Nothing has been shared in this chat.</p>'}
    ${notes}
  </section>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(`Work History: ${doc.client.name}`)}</title>
<style>${STYLE}</style>
</head>
<body>
  <h1>Work History: ${escape(doc.client.name)}</h1>
  <div class="muted">${escape(doc.workspace)}</div>
  <table class="facts">
    <tr><td>Client</td><td>${escape(doc.client.name)}${doc.client.company ? `, ${escape(doc.client.company)}` : ""}</td></tr>
    <tr><td>Exported by</td><td>${escape(doc.exportedBy)}</td></tr>
    <tr><td>Exported on</td><td>${when(doc.generatedAt)}</td></tr>
    <tr><td>Contents</td><td>${t.chats} ${t.chats === 1 ? "chat" : "chats"}, ${t.messages} ${t.messages === 1 ? "message" : "messages"}, ${t.notes} ${t.notes === 1 ? "note" : "notes"}</td></tr>
  </table>
  <div class="scope">${escape(SCOPE)}</div>
  ${chats}
  <footer>Built in the browser of the person who exported it, from the team's encrypted copy of each chat. The export is logged by Konva with who exported which client, when and how many messages, and never with any text.</footer>
</body>
</html>
`;
}

/** The same content as data. Times are ISO 8601 in UTC. */
export function buildExportJson(doc: ExportDoc): string {
  const t = totals(doc);
  return JSON.stringify({
    format: "konva-client-work-history",
    version: 1,
    generatedAt: doc.generatedAt,
    workspace: doc.workspace,
    exportedBy: doc.exportedBy,
    client: doc.client,
    scope: SCOPE,
    totals: t,
    chats: doc.chats.map((c) => ({
      threadId: c.threadId,
      label: c.label,
      channel: c.channel,
      kind: c.kind,
      agent: c.agent,
      inbox: c.inbox,
      sharedAt: c.sharedAt,
      shareFrom: c.shareFrom,
      notYetShared: c.notYetShared,
      messages: c.messages.map((m) => ({ id: m.id, sentAt: m.sentAt, direction: m.direction, from: m.from, to: m.to, subject: m.subject || null, text: m.text, quoted: m.quoted, attachments: m.files })),
      notes: c.notes,
    })),
  }, null, 2);
}

/** A file name that is safe on any system: "Work History Thandi Mokoena 2026-11-04.html". */
export function exportFileName(doc: ExportDoc, extension: "html" | "json"): string {
  const name = doc.client.name.replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Client";
  return `Work History ${name} ${doc.generatedAt.slice(0, 10)}.${extension}`;
}
