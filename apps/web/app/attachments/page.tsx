"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Paperclip, Search } from "lucide-react";
import { loadAttachments } from "@/lib/data";
import { useApp } from "@/lib/store";
import type { Attachment, FiledAttachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { EmptyState } from "@/components/primitives";
import { AttachmentGrid, SOURCE_LABEL, filesLabel, sourceOf, type Source } from "@/components/attachments";

type Kind = "all" | "image" | "pdf" | "audio" | "video" | "file";

const KINDS: { key: Kind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "pdf", label: "PDFs" },
  { key: "audio", label: "Voice Notes" },
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

  // The header grows and shrinks with its wrapped rows, and the scrollbar starts below it.
  const header = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(104);
  useEffect(() => {
    const el = header.current;
    if (!el) return;
    const measure = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    measure.observe(el);
    setHeaderHeight(el.offsetHeight);
    return () => measure.disconnect();
  }, []);

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

  // Everyone who sent one of the loaded files, with you first.
  const people = useMemo(() => {
    const ids = new Set((files || []).map((a) => a.from));
    return [...ids].sort((x, y) => (x === "me" ? -1 : y === "me" ? 1 : nameOf(x).localeCompare(nameOf(y)))).map((id) => ({ id, name: nameOf(id) }));
  }, [files, nameOf]);

  const filtered = person !== "all" || source !== "all" || date !== "any";

  const shown = useMemo(() => {
    if (!files) return [];
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const days = DATES.find((d) => d.key === date)?.days ?? 0;
    const since = days ? new Date(Date.now() - days * DAY).toISOString() : "";
    return files.filter((a) => {
      if (!matchesKind(kind, a)) return false;
      if (person !== "all" && a.from !== person) return false;
      if (source !== "all" && sourceOf(threadById(a.threadId)?.provider) !== source) return false;
      if (since && a.sentAt < since) return false;
      const haystack = searchText.get(a.id) ?? "";
      return words.every((w) => haystack.includes(w));
    });
  }, [files, kind, query, searchText, person, source, date, threadById]);

  const clearFilters = () => { setPerson("all"); setSource("all"); setDate("any"); };

  const kindLabel = KINDS.find((k) => k.key === kind)?.label;

  return (
    // Same solid header, with a line under it, as Summary, Conversations and Contacts; the scrollbar starts below it.
    <ScrollArea
      className="h-full"
      style={{ "--attachments-header": `${headerHeight}px` } as CSSProperties}
      scrollbarClassName="data-vertical:top-[var(--attachments-header)]! data-vertical:h-auto!"
    >
      <div ref={header} className="sticky top-0 z-10 space-y-2 border-b bg-background p-3">
        <div className="flex h-10 items-center justify-between gap-3">
          <h1 className="text-lg font-medium">Attachments</h1>
          <InputGroup className="max-w-64 min-w-0 flex-1">
            <InputGroupAddon><Search /></InputGroupAddon>
            <InputGroupInput type="search" value={query} onChange={(e) => search(e.target.value)} placeholder="Search" aria-label="Search by Name or Sender" />
          </InputGroup>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Tabs value={kind} onValueChange={(v) => router.replace(urlFor(v as Kind, query), { scroll: false })} className="max-w-full">
            <TabsList aria-label="Type" className="max-w-full overflow-x-auto">
              {KINDS.map((k) => (
                <TabsTrigger key={k.key} value={k.key} className="px-3">{k.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex shrink-0 items-center gap-2">
            <Switch id="show-hidden" checked={showHidden} onCheckedChange={setShowHidden} />
            <Label htmlFor="show-hidden" className="text-sm font-normal whitespace-nowrap text-muted-foreground">Show Hidden</Label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={person} onValueChange={setPerson}>
            <SelectTrigger size="sm" aria-label="Person" className="max-w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger size="sm" aria-label="Source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              {SOURCES.map((k) => <SelectItem key={k} value={k}>{SOURCE_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={date} onValueChange={setDate}>
            <SelectTrigger size="sm" aria-label="Date"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DATES.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {files && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{filesLabel(shown.length)}</span>}
        </div>
      </div>
      <div className="px-3 pb-3">
        {files === null && (
          <div role="status" aria-busy="true" aria-label="Loading Attachments" className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-3 gap-y-4 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1">
                <Skeleton className="aspect-square w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
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
              action={<Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>Try Again</Button>}
            />
          </div>
        )}
        {files && shown.length === 0 && (
          <div className="py-24">
            {query.trim() ? (
              <EmptyState
                icon={Search}
                title="No Matches"
                description="Try another file name or sender."
                action={<Button variant="outline" onClick={() => search("")}>Clear Search</Button>}
              />
            ) : filtered ? (
              <EmptyState
                icon={Paperclip}
                title="No Matches"
                description="No files fit these filters."
                action={<Button variant="outline" onClick={clearFilters}>Clear Filters</Button>}
              />
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
            <AttachmentGrid items={shown} byMonth />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AttachmentsPage />
    </Suspense>
  );
}
