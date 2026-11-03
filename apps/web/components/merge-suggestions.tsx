"use client";

// The Suggested Merges page under Contacts: pairs the linker thinks are one person, to merge one at a time or all at once.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { markSubmitted } from "@/lib/analytics";
import type { ContactSummary } from "@/lib/contacts";
import { dismissSuggestion, mergeSide, type MergeSuggestion } from "@/lib/contact-merging";
import { CERTAIN_SCORE, namesDiffer, planMerge, suggestionEvidence, suggestionReasonText } from "@/lib/merging";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/lib/store";
import { formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { DIALOG_BUTTONS, MergeDialog, useCloseOnOverlay } from "@/components/merge-dialog";
import { useContactsData } from "@/components/contacts-data";
import { DetailHeading, DetailPage, plural } from "@/components/contact-list";
import { IconCircle } from "@/components/surface";
import { withQuery } from "@/lib/utils";

function Person({ contact, query, keeping }: { contact: ContactSummary; query: string; keeping?: boolean }) {
  const reach = [...contact.emails, ...contact.phones.map(formatPhone), ...contact.handles.map((h) => `@${h}`)];
  return (
    <Link
      href={withQuery(`/contacts/${contact.id}`, query)}
      className="flex min-w-0 flex-1 items-start gap-3 rounded-lg p-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <ContactAvatar contact={contact} className="size-10 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{contact.name}</span>
          {keeping && <Badge variant="secondary">Keeping</Badge>}
        </span>
        {reach.map((r) => (
          <span key={r} className="truncate text-xs text-muted-foreground">{r}</span>
        ))}
        {reach.length === 0 && contact.hasWhatsApp && <span className="truncate text-xs text-muted-foreground">WhatsApp, number hidden</span>}
        <span className="truncate text-xs text-muted-foreground">{plural(contact.conversationCount, "conversation")}</span>
      </div>
    </Link>
  );
}

function SuggestionCard({ suggestion, a, b, query, locked }: { suggestion: MergeSuggestion; a: ContactSummary; b: ContactSummary; query: string; locked: boolean }) {
  const { mergeContacts } = useApp();
  const { removeSuggestion, restoreSuggestion } = useContactsData();
  const [busy, setBusy] = useState<"merging" | "dismissing" | null>(null);
  const [asking, setAsking] = useState(false);
  const organization = a.organizationName && a.organizationName === b.organizationName ? a.organizationName : null;
  const sides = [mergeSide(a), mergeSide(b)] as const;
  // Who survives, so the person sees what a merge does before pressing it. Where the names differ the dialog asks.
  const keepId = planMerge(...sides).keepId;
  const evidence = suggestionEvidence(suggestion.reason, ...sides, formatPhone);

  const merge = async (name?: string) => {
    setBusy("merging");
    const plan = planMerge(...sides, name);
    const id = await mergeContacts(plan.keepId, plan.mergeId, "suggestion", plan.name);
    setBusy(null);
    if (id) removeSuggestion(suggestion.id);
  };

  const notSame = async () => {
    setBusy("dismissing");
    removeSuggestion(suggestion.id);
    // Put it back if the dismissal was not saved, so it does not seem gone and then return on the next load.
    if (!(await dismissSuggestion(suggestion.id))) {
      restoreSuggestion(suggestion);
      toast("Could not save that change. Check your connection and try again.");
    }
    setBusy(null);
  };

  return (
    <div className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3">
        <p className="text-xs text-muted-foreground">{[suggestionReasonText(suggestion.reason, ...sides, organization), ...evidence].join(". ")}</p>
        <Badge variant="secondary">{suggestion.score >= CERTAIN_SCORE ? "Very Likely" : "Possible"}</Badge>
      </div>
      <div className="flex flex-col gap-1 p-1 sm:flex-row">
        <Person contact={a} query={query} keeping={!namesDiffer(a.name, b.name) && keepId === a.id} />
        <Person contact={b} query={query} keeping={!namesDiffer(a.name, b.name) && keepId === b.id} />
      </div>
      <div className="flex justify-end gap-2 px-4 pb-3">
        <Button variant="secondary" disabled={busy !== null || locked} onClick={notSame}>Not the Same</Button>
        <Button disabled={busy !== null || locked} onClick={() => (namesDiffer(a.name, b.name) ? setAsking(true) : merge())}>{busy === "merging" ? "Merging" : "Merge"}</Button>
      </div>
      <MergeDialog a={a} b={b} open={asking} onOpenChange={setAsking} onConfirm={(name) => merge(name)} />
    </div>
  );
}

/** Merges every pair on the page after one confirmation. Where two names differ, the person with more conversations keeps theirs. */
function MergeAllDialog({ count, certainOnly, open, merging, onOpenChange, onConfirm }: { count: number; certainOnly: boolean; open: boolean; merging: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  useCloseOnOverlay(open && !merging, onOpenChange);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !merging && onOpenChange(next)}>
      <AlertDialogContent track="merge_all_contacts" aria-describedby={undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>{certainOnly ? "Merge Very Likely" : "Merge All"} {plural(count, "Pair")}?</AlertDialogTitle>
        </AlertDialogHeader>
        <div className={DIALOG_BUTTONS}>
          <AlertDialogCancel disabled={merging}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={merging}
            onClick={(e) => {
              // Stays open until every pair is done.
              e.preventDefault();
              markSubmitted("merge_all_contacts");
              onConfirm();
            }}
          >
            {merging ? "Merging" : certainOnly ? "Merge Very Likely" : "Merge All"}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function MergeSuggestions() {
  const { contacts, suggestions, removeSuggestion, reload } = useContactsData();
  const { mergeContacts, undoMerge, refreshContacts, notify } = useApp();
  const query = useSearchParams().toString();
  // Which pairs the confirmation is about: every pair, or only those the linker is sure of.
  const [confirmingAll, setConfirmingAll] = useState<"all" | "certain" | null>(null);
  const [mergingAll, setMergingAll] = useState(false);
  const rows = useMemo(() => {
    const byId = new Map((contacts ?? []).map((c) => [c.id, c]));
    return (suggestions ?? []).flatMap((s) => {
      const a = byId.get(s.contactA);
      const b = byId.get(s.contactB);
      return a && b ? [{ s, a, b }] : [];
    });
  }, [contacts, suggestions]);
  const loading = contacts === undefined || suggestions === undefined;

  const certain = useMemo(() => rows.filter((r) => r.s.score >= CERTAIN_SCORE), [rows]);

  const mergeAll = async () => {
    const batch = confirmingAll === "certain" ? certain : rows;
    setMergingAll(true);
    // Someone merged away earlier in the run is skipped in any later pair they appear in.
    const gone = new Set<string>();
    const done: string[] = [];
    let failed = 0;
    for (const { s, a, b } of batch) {
      if (gone.has(a.id) || gone.has(b.id)) continue;
      const plan = planMerge(mergeSide(a), mergeSide(b));
      // One message for the whole run, below, instead of a toast and an Undo for every pair.
      const id = await mergeContacts(plan.keepId, plan.mergeId, "suggestion", plan.name, { quiet: true });
      if (!id) {
        failed += 1;
        continue;
      }
      done.push(id);
      gone.add(plan.mergeId);
      removeSuggestion(s.id);
    }
    setMergingAll(false);
    setConfirmingAll(null);
    if (done.length === 0) return;
    const text = `Merged ${plural(done.length, "pair")}${failed ? `. ${plural(failed, "pair")} could not be merged.` : ""}`;
    notify(text, () => {
      // Each merge is undone, then the contacts are read once for all of them.
      void (async () => {
        let undone = 0;
        for (const id of done) if (await undoMerge(id, { refresh: false })) undone += 1;
        if (undone > 0) await refreshContacts([]);
        toast(undone === done.length ? "Merges undone" : `Undid ${undone} of ${done.length} merges`);
      })();
    });
  };

  return (
    <DetailPage
      backHref={withQuery("/contacts", query)}
      header={
        <>
          <DetailHeading avatar={<IconCircle icon={Users} />} title="Suggested Merges" />
          <div className="flex shrink-0 items-center gap-1">
            {!loading && certain.length > 0 && certain.length < rows.length && (
              <Button variant="secondary" disabled={mergingAll} onClick={() => setConfirmingAll("certain")}>Merge Very Likely</Button>
            )}
            {!loading && rows.length > 1 && (
              <Button variant="secondary" disabled={mergingAll} onClick={() => setConfirmingAll("all")}>{mergingAll ? "Merging" : "Merge All"}</Button>
            )}
          </div>
        </>
      }
    >
      {loading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 w-full rounded-lg" />)}
      {!loading && rows.length === 0 && (
        <div className="py-24">
          {suggestions === null || contacts === null ? (
            <EmptyState icon={Users} title="Suggestions Did Not Load" action={<Button variant="secondary" onClick={reload}>Retry</Button>} />
          ) : (
            <EmptyState icon={Users} title="No Suggested Merges" />
          )}
        </div>
      )}
      {rows.map(({ s, a, b }) => (
        <SuggestionCard key={s.id} suggestion={s} a={a} b={b} query={query} locked={mergingAll} />
      ))}
      <MergeAllDialog
        count={confirmingAll === "certain" ? certain.length : rows.length}
        certainOnly={confirmingAll === "certain"}
        open={confirmingAll !== null}
        merging={mergingAll}
        onOpenChange={(open) => !open && setConfirmingAll(null)}
        onConfirm={mergeAll}
      />
    </DetailPage>
  );
}
