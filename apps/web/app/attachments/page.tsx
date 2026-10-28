"use client";

// Every attachment from the connected chats in one place, filterable by kind, source and date.
// The kind lives in ?kind= so a reload keeps the tab.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Paperclip, Search } from "lucide-react";
import { loadAttachments } from "@/lib/data";
import { useApp } from "@/lib/store";
import type { Attachment, FiledAttachment } from "@/lib/types";
import { formatSize } from "@/lib/format";
import { PaneControls, PaneHeader, SearchBand, ViewButtons } from "@/components/pane";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { AttachmentGrid, SOURCE_LABEL, filesLabel, sourceOf, type Source } from "@/components/attachments";

type Kind = "all" | "image" | "pdf" | "video" | "file";

const KINDS: { key: Kind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "pdf", label: "PDFs" },
  { key: "video", label: "Media" },
  { key: "file", label: "Files" },
];

const matchesKind = (kind: Kind, a: Attachment) => kind === "all" || a.kind === kind;

const SOURCES: Source[] = ["gmail", "whatsapp", "icloud", "imap"];

const DAY = 24 * 60 * 60 * 1000;
const DATES: { key: string; label: string; days: number }[] = [
  { key: "any", label: "Any Time", days: 0 },
  { key: "week", label: "Past Week", days: 7 },
  { key: "month", label: "Past Month", days: 30 },
  { key: "quarter", label: "Past 3 Months", days: 90 },
  { key: "year", label: "Past Year", days: 365 },
];

function AttachmentsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { contactById, threadById } = useApp();
  const raw = params.get("kind") as Kind | null;
  const kind: Kind = raw && KINDS.some((k) => k.key === raw) ? raw : "all";
  const [showHidden, setShowHidden] = useState(false);
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [person, setPerson] = useState("all");
  const [source, setSource] = useState("all");
  const [date, setDate] = useState("any");
  // null until the first load, false if it failed. A later load (Show Hidden) keeps the tiles on screen.
  const [files, setFiles] = useState<FiledAttachment[] | null | false>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAttachments(showHidden).then(
      (next) => { if (!cancelled) { setFiles(next); setLoading(false); } },
      (err) => {
        console.error(err);
        if (!cancelled) { setFiles(false); setLoading(false); }
      },
    );
    return () => { cancelled = true; };
  }, [showHidden, attempt]);

  // The tab and the search live in the address, so a reload or a shared link comes back the same.
  const urlFor = (nextKind: Kind, q: string) => {
    const next = new URLSearchParams();
    if (nextKind !== "all") next.set("kind", nextKind);
    if (q.trim()) next.set("q", q);
    const text = next.toString();
    return text ? `/attachments?${text}` : "/attachments";
  };
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(typing.current), []);
  const search = (value: string) => {
    setQuery(value);
    clearTimeout(typing.current);
    typing.current = setTimeout(() => router.replace(urlFor(kind, value), { scroll: false }), 300);
  };

  const nameOf = useCallback((from: string) => (from === "me" ? "You" : contactById(from)?.name ?? "Unknown"), [contactById]);

  // Built once per load, not on every keystroke.
  const searchText = useMemo(() => {
    const text = new Map<string, string>();
    for (const a of files || []) {
      const contact = a.from === "me" ? undefined : contactById(a.from);
      text.set(a.id, [a.name, a.from === "me" ? "you" : contact?.name, ...(contact?.emails ?? [])].join(" ").toLowerCase());
    }
    return text;
  }, [files, contactById]);

  const filtered = person !== "all" || source !== "all" || date !== "any";

  // Everything but the person filter, so the list of people can say how many files each one has in view.
  const inView = useMemo(() => {
    if (!files) return [];
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const days = DATES.find((d) => d.key === date)?.days ?? 0;
    const since = days ? new Date(Date.now() - days * DAY).toISOString() : "";
    return files.filter((a) => {
      if (!matchesKind(kind, a)) return false;
      if (source !== "all" && sourceOf(threadById(a.threadId)?.provider) !== source) return false;
      if (since && a.sentAt < since) return false;
      const haystack = searchText.get(a.id) ?? "";
      return words.every((w) => haystack.includes(w));
    });
  }, [files, kind, query, searchText, source, date, threadById]);

  // Everyone who sent one of the files in view, with you first.
  const people = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of inView) counts.set(a.from, (counts.get(a.from) ?? 0) + 1);
    return [...counts].sort(([x], [y]) => (x === "me" ? -1 : y === "me" ? 1 : nameOf(x).localeCompare(nameOf(y)))).map(([id, count]) => ({ id, name: nameOf(id), count }));
  }, [inView, nameOf]);

  const shown = useMemo(() => (person === "all" ? inView : inView.filter((a) => a.from === person)), [inView, person]);

  const clearFilters = () => { setPerson("all"); setSource("all"); setDate("any"); };

  const kindLabel = KINDS.find((k) => k.key === kind)?.label;

  return (
    // The same split as Conversations and Contacts: the filters on the left, the files beside them.
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col md:h-full md:w-80 md:border-r lg:w-1/3">
        <PaneHeader
          title="Attachments"
          action={
            <div className="flex shrink-0 items-center gap-2">
              <Switch id="show-hidden" checked={showHidden} onCheckedChange={setShowHidden} />
              <Label htmlFor="show-hidden" className="text-sm font-normal whitespace-nowrap text-muted-foreground">Show Hidden</Label>
            </div>
          }
        >
          <PaneControls>
            <ViewButtons label="Type" value={kind} items={KINDS} onSelect={(k) => router.replace(urlFor(k, query), { scroll: false })} />
          </PaneControls>
          <div className="grid grid-cols-2 gap-2">
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger aria-label="Source" className="w-full data-[size=default]:h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {SOURCES.map((k) => <SelectItem key={k} value={k}>{SOURCE_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={date} onValueChange={setDate}>
              <SelectTrigger aria-label="Date" className="w-full data-[size=default]:h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATES.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </PaneHeader>
        <SearchBand value={query} onChange={search} placeholder="Search Attachments" />
        {/* Who the files are from. Choosing one shows only theirs. */}
        <ScrollArea className="hidden min-h-0 flex-1 md:block">
          <div className="flex flex-col gap-1 p-3">
            {[{ id: "all", name: "Everyone", count: inView.length }, ...people].map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={person === p.id}
                onClick={() => setPerson(p.id)}
                className={cn("flex items-center gap-3 rounded-lg p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", person === p.id ? "bg-muted" : "hover:bg-muted/50")}
              >
                {p.id === "all" ? (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"><Paperclip className="size-4" /></span>
                ) : (
                  <ContactAvatar contact={p.id === "me" ? undefined : contactById(p.id)} className="size-8" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{p.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col md:h-full">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-background p-3 md:px-4">
          <span className="flex h-8 items-center text-sm text-muted-foreground tabular-nums">{files ? filesLabel(shown.length) : "Loading"}</span>
          <span className="flex items-center gap-3">
            {(filtered || query.trim()) && files && <Button variant="ghost" onClick={() => { clearFilters(); search(""); }}>Clear Filters</Button>}
            {files && <span className="flex h-8 items-center text-sm text-muted-foreground tabular-nums">{formatSize(shown.reduce((sum, f) => sum + (f.path ? f.bytes ?? 0 : 0), 0))}</span>}
          </span>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3 md:px-4">
            {files === null && (
              <div role="status" aria-busy="true" aria-label="Loading Attachments" className="grid grid-cols-3 gap-x-3 gap-y-4 md:grid-cols-6">
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <Skeleton className="aspect-square w-full rounded-lg" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ))}
              </div>
            )}
            {files === false && (
              <div className="py-24">
                <EmptyState
                  icon={Paperclip}
                  title="Attachments Did Not Load"
                  description="Check your connection, then try again."
                  action={<Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Try Again</Button>}
                />
              </div>
            )}
            {files && shown.length === 0 && (
              <div className="py-24">
                {query.trim() ? (
                  <EmptyState icon={Search} title="No Matches" description="Try another file name or sender." />
                ) : filtered ? (
                  <EmptyState icon={Paperclip} title="No Matches" description="No files fit these filters." />
                ) : (
                  <EmptyState
                    icon={Paperclip}
                    title={kind === "all" ? "No Attachments Yet" : `No ${kindLabel}`}
                    description="Files from your conversations appear here as your accounts sync."
                  />
                )}
              </div>
            )}
            {shown.length > 0 && (
              <div aria-busy={loading} className={cn("transition-opacity", loading && "opacity-60")}>
                <AttachmentGrid items={shown} byMonth className="grid-cols-3 md:grid-cols-6" />
              </div>
            )}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AttachmentsPage />
    </Suspense>
  );
}
