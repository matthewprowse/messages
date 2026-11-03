"use client";

// Every attachment from the connected chats in one place, laid out like Conversations: the kinds as views, a Filter
// (source, date, document type, sort and Show Hidden) and a search, over a grid of white tiles on the grey pane. Files load
// a page at a time. The filters live in the address, so a reload or shared link comes back the same; the filtering is in
// lib/attachment-filters.ts and the paging in lib/attachment-pages.ts. Select picks several files for Download (a zip),
// Hide and Delete (Konva's copy only); the rules for those are in lib/attachment-actions/.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Paperclip, Search } from "lucide-react";
import { docFilterOf, matchesDocFilter } from "@/lib/search/document-card";
import { setAttachmentsHidden } from "@/lib/data";
import { deleteAttachmentFiles } from "@/lib/attachment-actions/load-copies";
import { downloadZip } from "@/lib/attachment-actions/download-zip";
import { actionsFor, selectedFiles, sortLargest, toggled } from "@/lib/attachment-actions/selection";
import { zipMessage } from "@/lib/attachment-actions/zip";
import { useApp } from "@/lib/store";
import { useAttachmentPages, type AttachmentList } from "@/lib/use-attachment-pages";
import { filterFiles, filtersHref, isNarrowed, KINDS, parseFilters, searchTextOf, sourcesIn, type Filters, type Kind } from "@/lib/attachment-filters";
import { SOURCE_LABEL, sourceOf } from "@/lib/attachment-view";
import type { FiledAttachment } from "@/lib/types";
import { PaneHeader, ViewButtons } from "@/components/pane";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/primitives";
import { AttachmentGrid } from "@/components/attachments";
import { DeleteFilesDialog } from "@/components/attachments/delete-dialog";
import { useDocumentCards } from "@/components/attachments/document-store";
import { FilterMenu, type FileFilters } from "@/components/attachments/filter-menu";
import { LoadingTiles } from "@/components/attachments/loading-tiles";
import { SelectionBar } from "@/components/attachments/selection-bar";

const COLUMNS = "grid-cols-3 md:grid-cols-6 xl:grid-cols-8";
// White cards on the grey pane; ring-0 because the border draws the edge (a selected tile's ring still shows).
const TILE = "border bg-background ring-0";

function AttachmentsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { contactById, threadById, threads, notify } = useApp();
  const fromAddress = parseFilters((k) => params.get(k));
  const { kind } = fromAddress;
  // The search is typed into at once and written to the address after a pause; everything else is read from the address.
  const [query, setQuery] = useState(fromAddress.q);
  const filters: Filters = { ...fromAddress, q: query };
  // The document filter (Invoices, Contracts...) and Show Hidden are kept in the address beside the others.
  const doc = docFilterOf(params.get("doc"));
  const showHidden = params.get("hidden") === "1";
  const hrefWith = (f: Filters, d = doc, h = showHidden) => {
    const extra = [d === "all" ? "" : `doc=${d}`, h ? "hidden=1" : ""].filter(Boolean).join("&");
    const base = filtersHref(f);
    return extra ? `${base}${base.includes("?") ? "&" : "?"}${extra}` : base;
  };
  const go = (patch: Partial<Filters>) => router.replace(hrefWith({ ...filters, ...patch }), { scroll: false });
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(typing.current), []);
  const search = (value: string) => {
    setQuery(value);
    clearTimeout(typing.current);
    typing.current = setTimeout(() => router.replace(hrefWith({ ...filters, q: value }), { scroll: false }), 300);
  };
  const setMenu = (patch: Partial<FileFilters>) => {
    const { doc: d = doc, hidden: h = showHidden, ...rest } = patch;
    router.replace(hrefWith({ ...filters, ...rest }, d, h), { scroll: false });
  };
  // Clear Filters resets the menu's own choices; the view and the search have their own controls.
  const clearMenu = () => router.replace(hrefWith({ ...filters, source: "all", date: "any", sort: "newest" }, "all", false), { scroll: false });

  const visible = useAttachmentPages(kind, "visible");
  const hidden = useAttachmentPages(kind, "hidden", showHidden);
  const narrowed = isNarrowed(filters) || doc !== "all";

  // A filter or search can only be right about files that are loaded, so while one is on the remaining pages are fetched.
  useEffect(() => { if (narrowed && visible.files && visible.more && !visible.loading) visible.loadMore(); }, [narrowed, visible]);
  useEffect(() => { if (narrowed && showHidden && hidden.files && hidden.more && !hidden.loading) hidden.loadMore(); }, [narrowed, showHidden, hidden]);

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
  const everything = useMemo(() => [...shown, ...(showHidden ? shownHidden : [])], [shown, shownHidden, showHidden]);
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
      notify(`Deleted ${ids.length} ${ids.length === 1 ? "file" : "files"} from Konva.`);
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
  const selection = { selecting, selected, onToggle: (id: string) => setSelected((s) => toggled(s, id)) };
  const nothing = loaded && shown.length === 0 && !visible.more && !(showHidden && shownHidden.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PaneHeader
          title="Attachments"
          action={
            <>
              <FilterMenu value={{ source: filters.source, date: filters.date, doc, sort: filters.sort, hidden: showHidden }} sources={sources} onChange={setMenu} onClear={clearMenu} />
              {(selecting || everything.length > 0) && (
                <Button variant={selecting ? "secondary" : "ghost"} aria-pressed={selecting} onClick={() => (selecting ? endSelecting() : setSelecting(true))}>
                  {selecting ? "Done" : "Select"}
                </Button>
              )}
            </>
          }
          // While selecting, the bar holds the views row's 40px slot, as in Conversations.
          views={selecting ? (
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
          ) : (
            <ViewButtons label="Type" value={kind} items={KINDS} onSelect={(k: Kind) => go({ kind: k })} />
          )}
          search={{ value: query, onChange: search, placeholder: "Search Attachments" }}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1 bg-muted/50">
        <div className="p-3 md:p-6">
          {loaded === null && <LoadingTiles className={COLUMNS} />}
          {loaded === false && (
            <div className="py-24">
              <EmptyState icon={Paperclip} title="Attachments Did Not Load" action={<Button variant="secondary" onClick={visible.retry}>Try Again</Button>} />
            </div>
          )}
          {nothing && (
            <div className="py-24">
              {query.trim() ? (
                <EmptyState icon={Search} title="No Matches" />
              ) : narrowed ? (
                <EmptyState icon={Paperclip} title="No Matches" />
              ) : (
                <EmptyState icon={Paperclip} title={kind === "all" ? "No Attachments Yet" : `No ${kindLabel}`} />
              )}
            </div>
          )}
          {shown.length > 0 && (
            <AttachmentGrid items={shown} byMonth={!largest} className={COLUMNS} tileClassName={TILE} onToggleHidden={toggleHidden} onDelete={(a) => requestDelete([a])} selection={selection} onEnd={visible.more && !narrowed ? visible.loadMore : undefined} />
          )}
          {loaded && shown.length === 0 && visible.more && <LoadingTiles label="Searching Your Files" className={COLUMNS} />}
          {/* Hidden files (inline logos, tiny images, junk and the ones you hide) come under the grid with Show Hidden. */}
          {showHidden && loaded && (
            <section aria-label="Hidden Files" className="mt-6 flex flex-col gap-2 first:mt-0">
              {(shownHidden.length > 0 || hidden.files === null || hidden.files === false) && <h2 className="text-sm font-medium">Hidden Files</h2>}
              {hidden.files === null && <LoadingTiles label="Loading Hidden Files" count={6} className={COLUMNS} />}
              {hidden.files === false && <div><Button variant="secondary" onClick={hidden.retry}>Try Again</Button></div>}
              {shownHidden.length > 0 && (
                <AttachmentGrid items={shownHidden} byMonth={!largest} className={COLUMNS} tileClassName={TILE} onToggleHidden={toggleHidden} onDelete={(a) => requestDelete([a])} selection={selection} onEnd={hidden.more && !narrowed ? hidden.loadMore : undefined} />
              )}
            </section>
          )}
        </div>
      </ScrollArea>
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
