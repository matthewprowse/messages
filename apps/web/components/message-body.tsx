"use client";

import { Fragment, useMemo, useState } from "react";
import { track } from "@/lib/analytics";
import type { Message } from "@/lib/types";
import type { Emphasis, ForwardedEmail, Mark } from "@/lib/email-text";
import { bulkPreview, originalDoc } from "@/lib/email-text";
import { findEmphasis, richParts, sliceRanges, whatsappMarkup, type MarkRange } from "@/lib/rich-text";
import { Forward, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { open as openText } from "@/lib/vault";
import { FIELD } from "@messages/crypto/fields";

// Email text is always shown as text. Sender-supplied HTML never reaches the page DOM: bold, italics and
// the like are drawn from ranges over the text (rich-text.ts), and the original is only ever shown inside
// a sandboxed iframe by ViewOriginal below.
// bulk comes from Message.bulk, set when the message is loaded, and is shared with ViewOriginal.
export function MessageBody({ m, whatsapp, bulk }: { m: Message; whatsapp: boolean; bulk: boolean }) {
  const [showQuoted, setShowQuoted] = useState(false);
  // Newsletters and marketing mail lead with a short preview. View Original is the main way to read them.
  const preview = useMemo(() => (bulk && !whatsapp ? bulkPreview(m.body) : null), [bulk, whatsapp, m.body]);
  // WhatsApp text is shown as sent, with WhatsApp's own formatting and full links.
  if (whatsapp) return <WhatsAppText text={m.quoted ? `${m.body}\n${m.quoted}` : m.body} />;
  if (preview) {
    const more = preview.more || !!m.quoted;
    return (
      <div className="flex flex-col items-start gap-1">
        {showQuoted ? (
          <>
            <EmailText text={m.body} marks={m.marks} />
            {m.quoted && <div className="w-full whitespace-pre-wrap wrap-anywhere border-t border-current/20 pt-2 text-xs opacity-70"><Linked text={m.quoted} /></div>}
          </>
        ) : preview.text ? (
          <EmailText text={preview.text} marks={m.marks} />
        ) : (
          <div>This email is mostly images. Open the original to read it.</div>
        )}
        {more && <ToggleButton onClick={() => setShowQuoted((v) => !v)}>{showQuoted ? "Show Less" : "Show Full Text"}</ToggleButton>}
      </div>
    );
  }
  // Quoted history and the signature footer are left out: earlier messages have their own bubbles, and
  // View Original shows the email whole.
  if (m.forward) {
    return (
      <div className="flex flex-col gap-3">
        {m.body && <EmailText text={m.body} marks={m.marks} />}
        <ForwardedCard email={m.forward} marks={m.marks} />
      </div>
    );
  }
  return <EmailText text={m.body} marks={m.marks} />;
}

/** "Jane Doe <jane@x.com>" as the name, then the address, or the address on its own. */
function Person({ value }: { value: string }) {
  const m = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(value.trim());
  if (!m || !m[1]) return <>{m ? m[2] : value}</>;
  return <>{m[1]} <span className="opacity-70">&lt;{m[2]}&gt;</span></>;
}

/** A forwarded email: who sent it, when and its subject, then its text, set apart from the note above. */
function ForwardedCard({ email, marks }: { email: ForwardedEmail; marks?: Emphasis[] }) {
  const rows: [string, React.ReactNode][] = [];
  if (email.from) rows.push(["From", <Person key="from" value={email.from} />]);
  if (email.date) rows.push(["Date", email.date]);
  if (email.subject) rows.push(["Subject", email.subject]);
  if (email.to) rows.push(["To", <Person key="to" value={email.to} />]);
  return (
    <div className="rounded-md border border-current/15 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium opacity-70"><Forward className="size-3.5" />Forwarded Message</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs leading-5">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="opacity-70">{label}</dt>
            <dd className="min-w-0 truncate">{value}</dd>
          </Fragment>
        ))}
      </dl>
      {email.body && <div className="mt-3 border-t border-current/15 pt-3"><EmailText text={email.body} marks={marks} /></div>}
    </div>
  );
}

// A bullet ("•", "*", "-") or number ("1.", "2)") opening a line, then the item's text.
const LIST_ITEM = /^\s*([•*·▪◦‣–-]|\d{1,2}[.)])\s+(\S.*)$/;

type Block = { kind: "text"; start: number; end: number; gap: boolean } | { kind: "item"; marker: string; start: number; end: number; gap: boolean };

/**
 * Email text with its lists laid out as lists: each item indented, its marker in a column of its own and
 * wrapped lines lining up under the item's text rather than under the marker. A blank line between
 * blocks becomes a line's worth of space. Blocks are kept as places in text so the bold and italic runs
 * found in it (marks) line up.
 */
function EmailText({ text, marks }: { text: string; marks?: Emphasis[] }) {
  const ranges = useMemo(() => (marks?.length ? findEmphasis(text, marks) : []), [text, marks]);
  const blocks: Block[] = [];
  let gap = false;
  let at = 0;
  for (const line of text.split("\n")) {
    const start = at;
    const end = at + line.length;
    at = end + 1;
    if (!line.trim()) { gap = blocks.length > 0; continue; }
    const item = LIST_ITEM.exec(line);
    const last = blocks.at(-1);
    if (item) blocks.push({ kind: "item", marker: /^\d/.test(item[1]) ? item[1] : "•", start: end - item[2].length, end, gap });
    else if (last?.kind === "text" && !gap) last.end = end;
    else blocks.push({ kind: "text", start, end, gap });
    gap = false;
  }
  const rich = (b: Block) => <Rich text={text.slice(b.start, b.end)} ranges={sliceRanges(ranges, b.start, b.end)} />;
  return (
    <div className="wrap-anywhere">
      {blocks.map((b, i) =>
        b.kind === "item" ? (
          <div key={i} className={cn("flex gap-2 pl-2", b.gap && "mt-6")}>
            <span className="min-w-4 shrink-0 tabular-nums">{b.marker}</span>
            <span className="min-w-0">{rich(b)}</span>
          </div>
        ) : (
          <div key={i} className={cn("whitespace-pre-wrap", b.gap && "mt-6")}>{rich(b)}</div>
        ),
      )}
    </div>
  );
}

// WhatsApp's quote lines ("> text") and bulleted list lines ("* item", "- item").
const WA_QUOTE = /^>[ \t]?/;
const WA_ITEM = /^[*-][ \t]+(?=\S)/;

type ChatBlock = { kind: "text" | "quote" | "item"; lines: [number, number][] };

/**
 * A WhatsApp message as WhatsApp draws it: *bold*, _italic_, ~strikethrough~ and `code` with their
 * markers gone, quote lines set off, list lines as bullets and blank lines kept.
 */
function WhatsAppText({ text }: { text: string }) {
  const { text: plain, ranges } = useMemo(() => whatsappMarkup(text), [text]);
  const blocks: ChatBlock[] = [];
  let at = 0;
  for (const line of plain.split("\n")) {
    const start = at;
    const end = at + line.length;
    at = end + 1;
    const quote = WA_QUOTE.exec(line);
    const item = WA_ITEM.exec(line);
    const kind = quote ? "quote" : item ? "item" : "text";
    const from = start + (quote?.[0].length ?? item?.[0].length ?? 0);
    const last = blocks.at(-1);
    if (last && last.kind === kind && kind !== "item") last.lines.push([from, end]);
    else blocks.push({ kind, lines: [[from, end]] });
  }
  const rich = ([s, e]: [number, number]) => <Rich text={plain.slice(s, e)} ranges={sliceRanges(ranges, s, e)} shorten={false} />;
  return (
    <div className="wrap-anywhere">
      {blocks.map((b, i) =>
        b.kind === "item" ? (
          <div key={i} className="flex gap-2 pl-2">
            <span className="min-w-4 shrink-0">•</span>
            <span className="min-w-0 whitespace-pre-wrap">{rich(b.lines[0])}</span>
          </div>
        ) : b.kind === "quote" ? (
          <div key={i} className="my-1 border-l-2 border-current/30 pl-2 opacity-80">
            {b.lines.map((l, j) => <div key={j} className="min-h-5 whitespace-pre-wrap">{rich(l)}</div>)}
          </div>
        ) : (
          <div key={i} className="whitespace-pre-wrap">{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && "\n"}{rich(l)}</Fragment>)}</div>
        ),
      )}
    </div>
  );
}

function ToggleButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <Button variant="ghost" size="xs" className="-ml-2 text-current opacity-70 hover:opacity-100" onClick={onClick}>{children}</Button>;
}

const MARK_CLASS: Record<Mark, string> = {
  bold: "font-medium",
  italic: "italic",
  underline: "underline underline-offset-2",
  strike: "line-through",
  code: "font-mono text-[0.92em]",
};

/** Text with its links, and with the marks over it drawn as bold, italics and so on. */
function Rich({ text, ranges, shorten = true }: { text: string; ranges: MarkRange[]; shorten?: boolean }) {
  return richParts(text, ranges, shorten).map((p, i) => {
    const marked = p.marks?.map((m) => MARK_CLASS[m]).join(" ");
    if ("href" in p) return <a key={i} href={p.href} target="_blank" rel="noreferrer" title={p.href} className={cn("underline underline-offset-2", marked)}>{p.label}</a>;
    return marked ? <span key={i} className={marked}>{p.text}</span> : <Fragment key={i}>{p.text}</Fragment>;
  });
}

function Linked({ text }: { text: string }) {
  return <Rich text={text} ranges={[]} />;
}

// How long View Original waits for the sync worker to fetch an email from Gmail or iCloud.
const ORIGINAL_WAIT_MS = 30_000;
// A missed Realtime update is caught by checking the row again, after 2 seconds and then twice as long each time.
const ORIGINAL_RECHECK_MS = 2_000;
const ORIGINAL_RECHECK_MAX_MS = 10_000;

type Original = { status: "loading" } | { status: "ready"; html: string } | { status: "failed"; error: string };
type Answer = { status: "done"; html: string } | { status: "failed"; error: string } | { status: "timeout" };

/**
 * Waits for the sync worker to answer a request row: a Realtime subscription on that row, with a slower
 * re-check in case an update is missed. Settles once, then stops listening.
 */
function awaitAnswer(id: string): Promise<Answer> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = ORIGINAL_RECHECK_MS;
    const channel = supabase.channel(`original-${id}`);
    const deadline = setTimeout(() => finish({ status: "timeout" }), ORIGINAL_WAIT_MS);
    function finish(answer: Answer) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      void supabase.removeChannel(channel);
      resolve(answer);
    }
    async function check() {
      const { data: row } = await supabase.from("email_originals").select("status, html, error").eq("id", id).maybeSingle();
      if (settled || !row) return;
      if (row.status === "done" && row.html) finish({ status: "done", html: row.html });
      else if (row.status === "failed") finish({ status: "failed", error: row.error ?? "The original could not be fetched." });
    }
    function recheck() {
      timer = setTimeout(async () => {
        await check();
        if (settled) return;
        delay = Math.min(delay * 2, ORIGINAL_RECHECK_MAX_MS);
        recheck();
      }, delay);
    }
    channel
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "email_originals", filter: `id=eq.${id}` }, () => void check())
      // Once listening, look once, in case the answer came before the subscription was ready.
      .subscribe((status) => { if (status === "SUBSCRIBED") void check(); });
    recheck();
  });
}

/**
 * The email as it was sent, fetched from the provider when asked for: its HTML is not stored. The sync
 * worker answers a request row with the HTML encrypted for you; it is opened here, shown, and the request
 * is deleted at once. Kept in memory while the conversation is open, so reopening is instant.
 */
async function fetchOriginal(messageId: string): Promise<Original> {
  const { data, error } = await supabase.from("email_originals").insert({ message_id: messageId }).select("id").single();
  if (error || !data) return { status: "failed", error: "Could not ask your mailbox for the original." };
  const clear = () => void supabase.from("email_originals").delete().eq("id", data.id).then(() => undefined);
  const answer = await awaitAnswer(data.id);
  clear();
  if (answer.status === "done") {
    const html = await openText(FIELD.html, answer.html);
    return html ? { status: "ready", html } : { status: "failed", error: "The original could not be opened." };
  }
  if (answer.status === "failed") return { status: "failed", error: answer.error };
  return { status: "failed", error: "Your mailbox took too long to answer. Try again." };
}

/** An icon button, shown beside Reply, that opens the email as it was sent. */
export function ViewOriginal({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState<Original | null>(null);
  // Remote images are blocked until you allow them for this message.
  const [images, setImages] = useState(false);
  const doc = useMemo(() => (original?.status === "ready" ? originalDoc(original.html, images) : null), [original, images]);
  const load = () => {
    setOriginal({ status: "loading" });
    setImages(false);
    void fetchOriginal(messageId).then(setOriginal);
  };
  const show = () => {
    track("original_opened", { channel: "email" });
    setOpen(true);
    if (!original || original.status === "failed") load();
  };
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label="View Original" onClick={show}><Mail /></Button>
        </TooltipTrigger>
        <TooltipContent>View Original</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent track="view_original" className="flex h-[85dvh] flex-col sm:max-w-3xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Original Email</DialogTitle>
            <DialogDescription>The email as it was sent, fetched from your mailbox.</DialogDescription>
          </DialogHeader>
          {doc && !images && doc.blocked > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-md border p-2 pl-3 text-sm">
              <span className="min-w-0 text-muted-foreground">Images are hidden. Loading them tells the sender you opened this email.</span>
              <Button variant="secondary" className="shrink-0" onClick={() => setImages(true)}>Load Images</Button>
            </div>
          )}
          {doc ? (
            // No allow-scripts and no allow-same-origin: the email cannot run code or reach the app. Popups let links open in a new tab.
            <iframe title="Original Email" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={doc.srcdoc} className="min-h-0 w-full flex-1 rounded-md border" />
          ) : original?.status === "failed" ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-md border text-sm text-muted-foreground">
              <p>{original.error}</p>
              <Button variant="outline" onClick={load}>Try Again</Button>
            </div>
          ) : (
            <Skeleton className="min-h-0 w-full flex-1 rounded-md" />
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
