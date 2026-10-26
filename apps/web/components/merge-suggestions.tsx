"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { markSubmitted } from "@/lib/analytics";
import type { ContactSummary } from "@/lib/contacts";
import { dismissSuggestion, mergeSide, type MergeSuggestion } from "@/lib/contact-merging";
import { namesDiffer, planMerge, suggestionReasonText } from "@/lib/merging";
import { useApp } from "@/lib/store";
import { formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { DIALOG_BUTTONS, MergeDialog, useCloseOnOverlay } from "@/components/merge-dialog";
import { useContactsData } from "@/components/contacts-data";
import { DetailPage, plural } from "@/components/contact-list";
import { withQuery } from "@/lib/utils";

function Person({ contact, query }: { contact: ContactSummary; query: string }) {
  const reach = [...contact.emails, ...contact.phones.map(formatPhone)];
  return (
    <Link
      href={withQuery(`/contacts/${contact.id}`, query)}
      className="flex min-w-0 flex-1 items-start gap-3 rounded-lg p-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <ContactAvatar contact={contact} className="size-10 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{contact.name}</span>
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
  const { removeSuggestion } = useContactsData();
  const [busy, setBusy] = useState<"merging" | "dismissing" | null>(null);
  const [asking, setAsking] = useState(false);
  const organization = a.organizationName && a.organizationName === b.organizationName ? a.organizationName : null;

  const merge = async (name?: string) => {
    setBusy("merging");
    const plan = planMerge(mergeSide(a), mergeSide(b), name);
    const id = await mergeContacts(plan.keepId, plan.mergeId, "suggestion", plan.name);
    setBusy(null);
    if (id) removeSuggestion(suggestion.id);
  };

  const notSame = async () => {
    setBusy("dismissing");
    removeSuggestion(suggestion.id);
    if (!(await dismissSuggestion(suggestion.id))) toast("Could not save that change. Check your connection and try again.");
    setBusy(null);
  };

  return (
    <div className="rounded-lg border">
      <p className="px-4 pt-3 text-xs text-muted-foreground">{suggestionReasonText(suggestion.reason, mergeSide(a), mergeSide(b), organization)}</p>
      <div className="flex flex-col gap-1 p-1 sm:flex-row">
        <Person contact={a} query={query} />
        <Person contact={b} query={query} />
      </div>
      <div className="flex justify-end gap-2 px-4 pb-3">
        <Button variant="outline" size="sm" className="max-sm:h-10" disabled={busy !== null || locked} onClick={notSame}>Not the Same</Button>
        <Button size="sm" className="max-sm:h-10" disabled={busy !== null || locked} onClick={() => (namesDiffer(a.name, b.name) ? setAsking(true) : merge())}>{busy === "merging" ? "Merging" : "Merge"}</Button>
      </div>
      <MergeDialog a={a} b={b} open={asking} onOpenChange={setAsking} onConfirm={(name) => merge(name)} />
    </div>
  );
}

/** Merges every pair on the page after one confirmation. Where two names differ, the person with more conversations keeps theirs. */
function MergeAllDialog({ count, open, merging, onOpenChange, onConfirm }: { count: number; open: boolean; merging: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  useCloseOnOverlay(open && !merging, onOpenChange);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !merging && onOpenChange(next)}>
      <AlertDialogContent track="merge_all_contacts">
        <AlertDialogHeader>
          <AlertDialogTitle>Merge All {plural(count, "Pair")}?</AlertDialogTitle>
          <AlertDialogDescription>
            Each pair becomes one contact with all their addresses, numbers and conversations. Where the two names differ, the person with more conversations keeps their name. You can undo each merge.
          </AlertDialogDescription>
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
            {merging ? "Merging" : "Merge All"}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function MergeSuggestions() {
  const { contacts, suggestions, removeSuggestion, reload } = useContactsData();
  const { mergeContacts } = useApp();
  const query = useSearchParams().toString();
  const [confirmingAll, setConfirmingAll] = useState(false);
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

  const mergeAll = async () => {
    setMergingAll(true);
    // Someone merged away earlier in the run is skipped in any later pair they appear in.
    const gone = new Set<string>();
    let merged = 0;
    for (const { s, a, b } of rows) {
      if (gone.has(a.id) || gone.has(b.id)) continue;
      const plan = planMerge(mergeSide(a), mergeSide(b));
      const id = await mergeContacts(plan.keepId, plan.mergeId, "suggestion", plan.name);
      if (!id) break;
      gone.add(plan.mergeId);
      removeSuggestion(s.id);
      merged += 1;
    }
    setMergingAll(false);
    setConfirmingAll(false);
    if (merged > 0) toast(`Merged ${plural(merged, "pair")}`);
  };

  return (
    <DetailPage
      backHref={withQuery("/contacts", query)}
      className="flex flex-col gap-3"
      header={
        <>
          <div className="flex h-10 min-w-0 flex-1 flex-col justify-center">
            <h1 className="truncate text-base font-medium">Suggested Merges</h1>
            {!loading && rows.length > 0 && <span className="truncate text-xs text-muted-foreground">People who may be the same person</span>}
          </div>
          {!loading && rows.length > 1 && (
            <Button variant="outline" disabled={mergingAll} onClick={() => setConfirmingAll(true)}>{mergingAll ? "Merging" : "Merge All"}</Button>
          )}
        </>
      }
    >
      {loading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 w-full rounded-lg" />)}
      {!loading && rows.length === 0 && (
        <div className="py-24">
          {suggestions === null || contacts === null ? (
            <EmptyState icon={Users} title="Suggestions Did Not Load" description="Check your connection, then try again." action={<Button variant="outline" onClick={reload}>Retry</Button>} />
          ) : (
            <EmptyState icon={Users} title="No Suggested Merges" description="When two contacts look like the same person, they show here." />
          )}
        </div>
      )}
      {rows.map(({ s, a, b }) => (
        <SuggestionCard key={s.id} suggestion={s} a={a} b={b} query={query} locked={mergingAll} />
      ))}
      <MergeAllDialog count={rows.length} open={confirmingAll} merging={mergingAll} onOpenChange={setConfirmingAll} onConfirm={mergeAll} />
    </DetailPage>
  );
}
