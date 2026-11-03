"use client";

// The changelog for Settings, Updates: its views, search and New Update, then each release as a card with its version and
// date in the title row and Publish or Unpublish beside them. The owner gate is the caller's; the database refuses anyone
// else. Settings, What's New shows the published ones.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import { CHANGE_KINDS, StaleUpdateError, dayLabel, loadUpdates, nextVersion, publishWarning, saveUpdate, sortUpdates, type ChangeKind, type Update } from "@/lib/updates";
import { PaneControls, SearchBand, ViewButtons } from "@/components/pane";
import { Card } from "@/components/surface";
import { EmptyState } from "@/components/primitives";
import { UpdateDialog } from "@/components/updates/update-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type View = "all" | "drafts" | "published";

/** The releases, newest first. */
export function UpdatesPanel() {
  const [updates, setUpdates] = useState<Update[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Update | undefined>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    loadUpdates().then(setUpdates).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({ all: updates?.length ?? 0, drafts: updates?.filter((u) => !u.published).length ?? 0, published: updates?.filter((u) => u.published).length ?? 0 }), [updates]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (u: Update) => !q || [u.title, u.summary, u.version, ...u.changes.map((c) => c.text)].some((t) => (t ?? "").toLowerCase().includes(q));
    return sortUpdates((updates ?? []).filter((u) => (view === "all" || (view === "drafts" ? !u.published : u.published)) && matches(u)));
  }, [updates, view, search]);
  const edit = (u?: Update) => { setEditing(u); setOpen(true); };
  const saved = (u: Update) => setUpdates((list) => sortUpdates([...(list ?? []).filter((x) => x.id !== u.id), u]));
  const removed = (id: string) => setUpdates((list) => (list ?? []).filter((x) => x.id !== id));

  const togglePublished = async (u: Update) => {
    const next = { ...u, published: !u.published };
    const warning = publishWarning(next);
    if (warning) return void toast.error(warning);
    setSaving(u.id);
    try {
      saved(await saveUpdate(next));
    } catch (err) {
      toast.error(err instanceof StaleUpdateError ? "This update changed elsewhere. Refreshing the list." : "The update could not be saved. Try again.");
      if (err instanceof StaleUpdateError) load();
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <PaneControls>
        <ViewButtons label="Show" value={view} onSelect={setView} items={[{ key: "all", label: `All (${counts.all})` }, { key: "drafts", label: `Drafts (${counts.drafts})` }, { key: "published", label: `Published (${counts.published})` }]} />
        <Button variant="secondary" className="ml-auto shrink-0" onClick={() => edit()}>New Update</Button>
      </PaneControls>
      {updates && updates.length > 0 && <SearchBand value={search} onChange={setSearch} placeholder="Search Updates" className="border-b-0 p-0" inputClassName="h-10" />}
      {updates === null && !failed && <div className="flex flex-col gap-3"><Skeleton className="h-32 w-full rounded-lg" /><Skeleton className="h-32 w-full rounded-lg" /></div>}
      {failed && <EmptyState icon={Megaphone} title="Could Not Load Updates" description="Check your connection and try again." action={<Button variant="secondary" onClick={load}>Retry</Button>} />}
      {updates && shown.length === 0 && (
        <div className="py-24">
          <EmptyState icon={Megaphone} title={updates.length === 0 ? "No Updates Yet" : "Nothing Here"} action={updates.length === 0 ? <Button variant="secondary" onClick={() => edit()}>New Update</Button> : undefined} />
        </div>
      )}
      {shown.map((u) => (
        <Card
          key={u.id}
          title={<span className="flex items-center gap-2">{[u.version, dayLabel(u.releasedOn)].filter(Boolean).join(", ")}{!u.published && <Badge variant="outline">Draft</Badge>}</span>}
          action={<Button variant="ghost" disabled={saving === u.id} onClick={() => void togglePublished(u)}>{u.published ? "Unpublish" : "Publish"}</Button>}
        >
          <button type="button" onClick={() => edit(u)} aria-label={`Edit ${u.title}`} className="flex w-full flex-col gap-1 rounded-lg p-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset">
            <span className="text-sm font-medium">{u.title}</span>
            {u.summary && <span className="text-sm text-muted-foreground">{u.summary}</span>}
          </button>
          <div className="flex flex-col gap-3 px-3 pb-3 empty:hidden">
            {CHANGE_KINDS.map(({ key, label }) => <Changes key={key} kind={key} label={label} update={u} />)}
          </div>
        </Card>
      ))}
      <UpdateDialog open={open} onOpenChange={setOpen} editing={editing} suggestedVersion={nextVersion(updates ?? [])} onSaved={saved} onDeleted={removed} onStale={load} />
    </div>
  );
}

function Changes({ kind, label, update }: { kind: ChangeKind; label: string; update: Update }) {
  const items = update.changes.filter((c) => c.kind === kind);
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-medium">{label}</h3>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm marker:text-muted-foreground">
        {items.map((c, i) => <li key={i}>{c.text}</li>)}
      </ul>
    </section>
  );
}
