"use client";

// Every attachment from the connected chats in one place, filterable by kind, source, date, person and search. Files load a
// page at a time and the header counts honestly; hidden files sit in a collapsed row under the grid, where they can be
// opened and unhidden. The tab, source, date, person and search live in the address, so a reload or shared link comes back
// the same. The filtering is in lib/attachment-filters.ts and the paging in lib/attachment-pages.ts.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Paperclip, Search } from "lucide-react";
import { setAttachmentsHidden } from "@/lib/data";
import { useApp } from "@/lib/store";
import { useAttachmentPages, type AttachmentList } from "@/lib/use-attachment-pages";
import { countLabel, effectivePerson, filterFiles, filtersHref, isNarrowed, KINDS, DATES, NO_FILTERS, parseFilters, peopleIn, searchTextOf, sizeLabel, sourcesIn, type Filters, type Kind } from "@/lib/attachment-filters";
import { filesLabel, SOURCE_LABEL, sourceOf } from "@/lib/attachment-view";
import type { FiledAttachment } from "@/lib/types";
import { PaneControls, PaneHeader, SearchBand, ViewButtons } from "@/components/pane";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { AttachmentGrid } from "@/components/attachments";

function AttachmentsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { contactById, threadById, threads, notify } = useApp();
  const fromAddress = parseFilters((k) => params.get(k));
  const { kind } = fromAddress;
  // The search is typed into at once and written to the address after a pause; everything else is read from the address.
  const [query, setQuery] = useState(fromAddress.q);
  const filters: Filters = { ...fromAddress, q: query };
  const go = (patch: Partial<Filters>) => router.replace(filtersHref({ ...filters, ...patch }), { scroll: false });
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(typing.current), []);
  const search = (value: string) => {
    setQuery(value);
    clearTimeout(typing.current);
    typing.current = setTimeout(() => router.replace(filtersHref({ ...filters, q: value }), { scroll: false }), 300);
  };

  const [hiddenOpen, setHiddenOpen] = useState(false);
  const visible = useAttachmentPages(kind, "visible");
  const hidden = useAttachmentPages(kind, "hidden", hiddenOpen);
  const narrowed = isNarrowed(filters);

  // A filter or search can only be right about files that are loaded, so while one is on the remaining pages are fetched.
  useEffect(() => { if (narrowed && visible.files && visible.more && !visible.loading) visible.loadMore(); }, [narrowed, visible]);
  useEffect(() => { if (narrowed && hiddenOpen && hidden.files && hidden.more && !hidden.loading) hidden.loadMore(); }, [narrowed, hiddenOpen, hidden]);

  const nameOf = useCallback((from: string) => (from === "me" ? "You" : contactById(from)?.name ?? "Unknown"), [contactById]);

  // Per file, built once per load and not on every keystroke: the account it came through, and the text a search looks in.
  const lists = [visible.files || [], hidden.files || []];
  const derived = useMemo(() => {
    const source = new Map<string, ReturnType<typeof sourceOf>>();
    const text = new Map<string, string>();
    for (const a of [...lists[0], ...lists[1]]) {
      const contact = a.from === "me" ? undefined : contactById(a.from);
      const thread = threadById(a.threadId);
      source.set(a.id, sourceOf(thread?.provider));
      text.set(a.id, searchTextOf(a.name, a.from === "me" ? "you" : contact?.name, ...(contact?.emails ?? []), thread?.subject));
    }
    return { source, text };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.files, hidden.files, contactById, threadById]);

  // The Source list comes from the data: every connected account's provider and every file's own.
  const sources = useMemo(() => {
    const found = sourcesIn([...threads.map((t) => t.provider), ...derived.source.values()]);
    const chosen = filters.source;
    return chosen === "all" || found.some((s) => s.key === chosen) ? found : [...found, { key: chosen as never, label: SOURCE_LABEL[chosen as never] ?? chosen }];
  }, [threads, derived, filters.source]);

  const ctx = useMemo(() => ({ sourceOf: (a: FiledAttachment) => derived.source.get(a.id), text: (a: FiledAttachment) => derived.text.get(a.id) ?? "", now: Date.now() }), [derived]);
  const inViewVisible = useMemo(() => filterFiles(lists[0], filters, ctx), [visible.files, kind, filters.source, filters.date, filters.q, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const inViewHidden = useMemo(() => filterFiles(lists[1], filters, ctx), [hidden.files, kind, filters.source, filters.date, filters.q, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Everyone who sent one of the files in view, with you first. A chosen person with nothing left in view falls back to Everyone.
  const people = useMemo(() => peopleIn(inViewVisible, nameOf), [inViewVisible, nameOf]);
  const person = effectivePerson(filters.person, people);
  const only = (files: FiledAttachment[]) => (person === "all" ? files : files.filter((a) => a.from === person));
  const shown = useMemo(() => only(inViewVisible), [inViewVisible, person]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownHidden = useMemo(() => only(inViewHidden), [inViewHidden, person]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide or unhide from the viewer: the file moves between the two lists at once, and goes back if it could not be saved.
  const toggleHidden = async (a: FiledAttachment) => {
    const hide = !a.hiddenReason;
    if (!(await setAttachmentsHidden([a.id], hide))) { notify("Could not save that. Try again."); return false; }
    const [from, to]: AttachmentList[] = hide ? [visible, hidden] : [hidden, visible];
    from.remove([a.id]);
    to.insert([{ ...a, hiddenReason: hide ? "manual" : undefined }]);
    return true;
  };

  const loaded = visible.files;
  const kindLabel = KINDS.find((k) => k.key === kind)?.label;
  const hiddenCount = hiddenOpen ? shownHidden.length : hidden.total;
  const showHiddenRow = !!loaded && ((hidden.total ?? 0) > 0 || hiddenOpen);
  const pickPerson = (id: string) => go({ person: id });

  return (
    // The same split as Conversations and Contacts: the filters on the left, the files beside them.
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col md:h-full md:w-80 md:border-r lg:w-1/3">
        <PaneHeader title="Attachments">
          <PaneControls>
            <ViewButtons label="Type" value={kind} items={KINDS} onSelect={(k: Kind) => go({ kind: k })} />
          </PaneControls>
          <div className="grid grid-cols-2 gap-2">
            <Select value={filters.source} onValueChange={(source) => go({ source })}>
              <SelectTrigger aria-label="Source" className="w-full data-[size=default]:h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {sources.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.date} onValueChange={(date) => go({ date })}>
              <SelectTrigger aria-label="Date" className="w-full data-[size=default]:h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATES.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* On a phone there is no people list beside the grid, so the sender is chosen here. */}
            <Select value={person} onValueChange={pickPerson}>
              <SelectTrigger aria-label="Sent By" className="col-span-2 w-full data-[size=default]:h-8 md:hidden"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </PaneHeader>
        <SearchBand value={query} onChange={search} placeholder="Search Attachments" />
        {/* Who the files are from. Choosing one shows only theirs. */}
        <ScrollArea className="hidden min-h-0 flex-1 md:block">
          <div className="flex flex-col gap-1 p-3">
            {[{ id: "all", name: "Everyone", count: inViewVisible.length }, ...people].map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={person === p.id}
                onClick={() => pickPerson(p.id)}
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
          <span className="flex h-8 items-center text-sm text-muted-foreground tabular-nums">
            {loaded ? countLabel({ shown: shown.length, total: kind === "audio" ? null : visible.total, more: visible.more, narrowed }) : loaded === false ? "Not Loaded" : "Loading"}
          </span>
          <span className="flex items-center gap-3">
            {(narrowed || kind !== "all") && loaded && <Button variant="ghost" onClick={() => { setQuery(""); router.replace(filtersHref(NO_FILTERS), { scroll: false }); }}>Clear Filters</Button>}
            {loaded && <span className="flex h-8 items-center text-sm text-muted-foreground tabular-nums">{sizeLabel(shown, visible.more)}</span>}
          </span>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3 md:px-4">
            {loaded === null && (
              <div role="status" aria-busy="true" aria-label="Loading Attachments" className="grid grid-cols-3 gap-x-3 gap-y-4 md:grid-cols-6">
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <Skeleton className="aspect-square w-full rounded-lg" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ))}
              </div>
            )}
            {loaded === false && (
              <div className="py-24">
                <EmptyState
                  icon={Paperclip}
                  title="Attachments Did Not Load"
                  description="Check your connection, then try again."
                  action={<Button variant="secondary" onClick={visible.retry}>Try Again</Button>}
                />
              </div>
            )}
            {loaded && shown.length === 0 && !visible.more && (
              <div className="py-24">
                {query.trim() ? (
                  <EmptyState icon={Search} title="No Matches" description="Try another file name, sender or subject." />
                ) : narrowed ? (
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
              <AttachmentGrid items={shown} byMonth className="grid-cols-3 md:grid-cols-6" onToggleHidden={toggleHidden} onEnd={visible.more && !narrowed ? visible.loadMore : undefined} />
            )}
            {loaded && shown.length === 0 && visible.more && (
              <p role="status" className="py-24 text-center text-sm text-muted-foreground">Searching your files</p>
            )}
            {/* Hidden files (inline logos, tiny images, junk and the ones you hide) stay out of the way until asked for. */}
            {showHiddenRow && (
              <div className="mt-6 border-t pt-3">
                <Button variant="ghost" aria-expanded={hiddenOpen} onClick={() => setHiddenOpen((o) => !o)} className="px-2">
                  {hiddenOpen ? <ChevronDown /> : <ChevronRight />}
                  {hiddenCount === null ? "Hidden Files" : filesLabel(hiddenCount).replace(/ File(s?)$/, " Hidden File$1")}
                </Button>
                {hiddenOpen && (
                  <div className="pt-3">
                    {hidden.files === null && <Skeleton className="h-24 w-full rounded-lg" />}
                    {hidden.files === false && <p className="text-sm text-muted-foreground">Hidden files did not load.</p>}
                    {hidden.files && shownHidden.length === 0 && !hidden.more && <p className="text-sm text-muted-foreground">{narrowed ? "No hidden files fit these filters." : "Nothing is hidden."}</p>}
                    {shownHidden.length > 0 && (
                      <AttachmentGrid items={shownHidden} byMonth className="grid-cols-3 md:grid-cols-6" onToggleHidden={toggleHidden} onEnd={hidden.more && !narrowed ? hidden.loadMore : undefined} />
                    )}
                  </div>
                )}
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
