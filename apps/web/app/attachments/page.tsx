"use client";

// Every attachment from the connected chats in one place, filterable by kind, source, date, document type and search. Files load a
// page at a time and the header counts honestly; hidden files sit in a collapsed row under the grid, where they can be
// opened and unhidden. The tab, source, date and search live in the address, so a reload or shared link comes back
// the same. The filtering is in lib/attachment-filters.ts and the paging in lib/attachment-pages.ts. Select picks several
// files for Download Selected (a zip), Hide Selected and Delete (Konva's copy only); Largest sorts by size. The rules for
// those are in lib/attachment-actions/.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Paperclip, Search } from "lucide-react";
import { DOC_FILTERS, docFilterOf, matchesDocFilter } from "@/lib/search/document-card";
import { setAttachmentsHidden } from "@/lib/data";
import { deleteAttachmentFiles } from "@/lib/attachment-actions/load-copies";
import { downloadZip } from "@/lib/attachment-actions/download-zip";
import { actionsFor, selectedFiles, SORTS, sortLargest, toggled, type Sort } from "@/lib/attachment-actions/selection";
import { zipMessage } from "@/lib/attachment-actions/zip";
import { useApp } from "@/lib/store";
import { useAttachmentPages, type AttachmentList } from "@/lib/use-attachment-pages";
import { countLabel, filterFiles, filtersHref, isNarrowed, KINDS, DATES, NO_FILTERS, parseFilters, searchTextOf, sizeLabel, sourcesIn, type Filters, type Kind } from "@/lib/attachment-filters";
import { filesLabel, SOURCE_LABEL, sourceOf } from "@/lib/attachment-view";
import type { FiledAttachment } from "@/lib/types";
import { PaneControls, PaneHeader, SearchBand, ViewButtons } from "@/components/pane";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/primitives";
import { AttachmentGrid } from "@/components/attachments";
import { DeleteFilesDialog } from "@/components/attachments/delete-dialog";
import { useDocumentCards } from "@/components/attachments/document-store";
import { SelectionBar } from "@/components/attachments/selection-bar";

function AttachmentsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { contactById, threadById, threads, notify } = useApp();
  const fromAddress = parseFilters((k) => params.get(k));
  const { kind } = fromAddress;
  // The search is typed into at once and written to the address after a pause; everything else is read from the address.
  const [query, setQuery] = useState(fromAddress.q);
  const filters: Filters = { ...fromAddress, q: query };
  // The document filter (Invoices, Contracts...) is kept in the address beside the others.
  const doc = docFilterOf(params.get("doc"));
  const hrefWith = (f: Filters, d = doc) => { const base = filtersHref(f); return d === "all" ? base : `${base}${base.includes("?") ? "&" : "?"}doc=${d}`; };
  const go = (patch: Partial<Filters>) => router.replace(hrefWith({ ...filters, ...patch }), { scroll: false });
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(typing.current), []);
  const search = (value: string) => {
    setQuery(value);
    clearTimeout(typing.current);
    typing.current = setTimeout(() => router.replace(hrefWith({ ...filters, q: value }), { scroll: false }), 300);
  };

  const [hiddenOpen, setHiddenOpen] = useState(false);
  const visible = useAttachmentPages(kind, "visible");
  const hidden = useAttachmentPages(kind, "hidden", hiddenOpen);
  const narrowed = isNarrowed(filters) || doc !== "all";

  // A filter or search can only be right about files that are loaded, so while one is on the remaining pages are fetched.
  useEffect(() => { if (narrowed && visible.files && visible.more && !visible.loading) visible.loadMore(); }, [narrowed, visible]);
  useEffect(() => { if (narrowed && hiddenOpen && hidden.files && hidden.more && !hidden.loading) hidden.loadMore(); }, [narrowed, hiddenOpen, hidden]);

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

  // Cards are looked up for every loaded file only while a document filter is on; otherwise the grid asks for the tiles it shows.
  const cardOf = useDocumentCards(useMemo(() => (doc === "all" ? [] : [...inViewVisible, ...inViewHidden].filter((a) => a.path && (a.kind === "pdf" || a.kind === "image")).map((a) => a.id)), [doc, inViewVisible, inViewHidden]));
  const cardType = (a: FiledAttachment) => { const e = cardOf(a.id); return e?.state === "card" ? e.card : null; };
  const only = (files: FiledAttachment[]) => files.filter((a) => matchesDocFilter(cardType(a), doc));
  const largest = filters.sort === "largest";
  const shown = useMemo(() => (largest ? sortLargest(only(inViewVisible)) : only(inViewVisible)), [inViewVisible, largest, doc, cardOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownHidden = useMemo(() => (largest ? sortLargest(only(inViewHidden)) : only(inViewHidden)), [inViewHidden, largest, doc, cardOf]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide or unhide from the viewer: the file moves between the two lists at once, and goes back if it could not be saved.
  const toggleHidden = async (a: FiledAttachment) => {
    const hide = !a.hiddenReason;
    if (!(await setAttachmentsHidden([a.id], hide))) { notify("Could not save that. Try again."); return false; }
    const [from, to]: AttachmentList[] = hide ? [visible, hidden] : [hidden, visible];
    from.remove([a.id]);
    to.insert([{ ...a, hiddenReason: hide ? "manual" : undefined }]);
    return true;
  };

  // Select: files picked for the bar's actions. Ids that leave the lists (hidden, deleted, filtered out) drop out of the count.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [working, setWorking] = useState(false);
  const everything = useMemo(() => [...shown, ...(hiddenOpen ? shownHidden : [])], [shown, shownHidden, hiddenOpen]);
  const picked = useMemo(() => selectedFiles(everything, selected), [everything, selected]);
  const endSelecting = () => { setSelecting(false); setSelected(new Set()); };

  // Delete asks first (one dialog for the bar and the viewer). The promise says whether the files went, so the viewer can move on.
  const [asking, setAsking] = useState<{ files: FiledAttachment[]; done: (ok: boolean) => void } | null>(null);
  const requestDelete = (files: FiledAttachment[]) => new Promise<boolean>((done) => setAsking({ files: files.filter((f) => !!f.path), done }));
  const confirmDelete = async () => {
    if (!asking) return;
    setWorking(true);
    const ids = asking.files.map((f) => f.id);
    const ok = await deleteAttachmentFiles(ids);
    if (ok) {
      visible.remove(ids);
      hidden.remove(ids);
      setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
      notify(`Deleted ${ids.length} ${ids.length === 1 ? "file" : "files"} from Konva. Your emails and chats are untouched.`);
    } else notify("Could not delete that. Try again.");
    asking.done(ok);
    setAsking(null);
    setWorking(false);
  };
  const cancelDelete = () => { asking?.done(false); setAsking(null); };

  const downloadPicked = async () => {
    setWorking(true);
    try {
      notify(zipMessage(await downloadZip(picked)));
    } catch {
      notify("The files did not download. Try again.");
    } finally {
      setWorking(false);
    }
  };
  const hidePicked = async () => {
    const hide = actionsFor(picked).hide;
    const files = picked.filter((f) => !!f.hiddenReason !== hide);
    if (files.length === 0) return;
    setWorking(true);
    const ids = files.map((f) => f.id);
    if (await setAttachmentsHidden(ids, hide)) {
      const [from, to]: AttachmentList[] = hide ? [visible, hidden] : [hidden, visible];
      from.remove(ids);
      to.insert(files.map((f) => ({ ...f, hiddenReason: hide ? ("manual" as const) : undefined })));
    } else notify("Could not save that. Try again.");
    setWorking(false);
  };

  const loaded = visible.files;
  const kindLabel = KINDS.find((k) => k.key === kind)?.label;
  const hiddenCount = hiddenOpen ? shownHidden.length : hidden.total;
  const showHiddenRow = !!loaded && ((hidden.total ?? 0) > 0 || hiddenOpen);

  return (
    // One column: the filters in the header, the files under them. (A Sent By list once filled a left column here; with it
    // gone the filters fit across the top.)
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PaneHeader title="Attachments">
          <PaneControls>
            <ViewButtons label="Type" value={kind} items={KINDS} onSelect={(k: Kind) => go({ kind: k })} />
          </PaneControls>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
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
            <Select value={doc} onValueChange={(d) => router.replace(hrefWith(filters, docFilterOf(d)), { scroll: false })}>
              <SelectTrigger aria-label="Document" className="col-span-2 w-full data-[size=default]:h-8 md:col-span-1"><SelectValue /></SelectTrigger>
              <SelectContent>{DOC_FILTERS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </PaneHeader>
        <SearchBand value={query} onChange={search} placeholder="Search Attachments" />
      </div>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col md:h-full">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-background p-3 md:px-4">
          <span className="flex h-8 items-center text-sm text-muted-foreground tabular-nums">
            {loaded ? countLabel({ shown: shown.length, total: kind === "audio" ? null : visible.total, more: visible.more, narrowed }) : loaded === false ? "Not Loaded" : "Loading"}
          </span>
          <span className="flex items-center gap-3">
            {(narrowed || kind !== "all") && loaded && <Button variant="ghost" onClick={() => { setQuery(""); router.replace(hrefWith(NO_FILTERS, "all"), { scroll: false }); }}>Clear Filters</Button>}
            {loaded && <span className="flex h-8 items-center text-sm text-muted-foreground tabular-nums">{sizeLabel(shown, visible.more)}</span>}
            <Select value={filters.sort} onValueChange={(sort) => go({ sort: sort as Sort })}>
              <SelectTrigger aria-label="Sort" className="w-28 data-[size=default]:h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{SORTS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
            {loaded && shown.length > 0 && !selecting && <Button variant="secondary" onClick={() => setSelecting(true)}>Select</Button>}
          </span>
        </header>
        {selecting && (
          <SelectionBar
            files={picked}
            total={everything.length}
            busy={working}
            onSelectAll={() => setSelected(new Set(everything.map((a) => a.id)))}
            onClear={() => setSelected(new Set())}
            onDownload={() => void downloadPicked()}
            onHide={() => void hidePicked()}
            onDelete={() => void requestDelete(picked)}
            onDone={endSelecting}
          />
        )}
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3 md:px-4">
            {loaded === null && (
              <div role="status" aria-busy="true" aria-label="Loading Attachments" className="grid grid-cols-3 gap-x-3 gap-y-4 md:grid-cols-6 xl:grid-cols-8">
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
              <AttachmentGrid items={shown} byMonth={!largest} className="grid-cols-3 md:grid-cols-6 xl:grid-cols-8" onToggleHidden={toggleHidden} onDelete={(a) => requestDelete([a])} selection={{ selecting, selected, onToggle: (id) => setSelected((s) => toggled(s, id)) }} onEnd={visible.more && !narrowed ? visible.loadMore : undefined} />
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
                      <AttachmentGrid items={shownHidden} byMonth={!largest} className="grid-cols-3 md:grid-cols-6 xl:grid-cols-8" onToggleHidden={toggleHidden} onDelete={(a) => requestDelete([a])} selection={{ selecting, selected, onToggle: (id) => setSelected((s) => toggled(s, id)) }} onEnd={hidden.more && !narrowed ? hidden.loadMore : undefined} />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </section>
      <DeleteFilesDialog files={asking?.files ?? null} busy={working} onCancel={cancelDelete} onConfirm={() => void confirmDelete()} />
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
