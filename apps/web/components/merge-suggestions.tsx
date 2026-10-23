"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import { toast } from "sonner";
import type { ContactSummary } from "@/lib/contacts";
import { dismissSuggestion, mergeSide, type MergeSuggestion } from "@/lib/contact-merging";
import { namesDiffer, planMerge, suggestionReasonText } from "@/lib/merging";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { MergeDialog } from "@/components/merge-dialog";
import { useContactsData } from "@/components/contacts-data";
import { DetailPage, plural, withQuery } from "@/components/contact-list";

function Person({ contact, query }: { contact: ContactSummary; query: string }) {
  const reach = [...contact.emails, ...contact.phones];
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

function SuggestionCard({ suggestion, a, b, query }: { suggestion: MergeSuggestion; a: ContactSummary; b: ContactSummary; query: string }) {
  const { mergeContacts } = useApp();
  const { removeSuggestion } = useContactsData();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const organization = a.organizationName && a.organizationName === b.organizationName ? a.organizationName : null;

  const merge = async (name?: string) => {
    setBusy(true);
    const plan = planMerge(mergeSide(a), mergeSide(b), name);
    const id = await mergeContacts(plan.keepId, plan.mergeId, "suggestion", plan.name);
    setBusy(false);
    if (id) removeSuggestion(suggestion.id);
  };

  const notSame = async () => {
    setBusy(true);
    removeSuggestion(suggestion.id);
    if (!(await dismissSuggestion(suggestion.id))) toast("Could not save that change. Check your connection and try again.");
    setBusy(false);
  };

  return (
    <div className="rounded-lg border">
      <p className="px-4 pt-3 text-xs text-muted-foreground">{suggestionReasonText(suggestion.reason, mergeSide(a), mergeSide(b), organization)}</p>
      <div className="flex flex-col gap-1 p-1 sm:flex-row">
        <Person contact={a} query={query} />
        <Person contact={b} query={query} />
      </div>
      <div className="flex justify-end gap-2 px-4 pb-3">
        <Button variant="outline" size="sm" disabled={busy} onClick={notSame}>Not the Same</Button>
        <Button size="sm" disabled={busy} onClick={() => (namesDiffer(a.name, b.name) ? setAsking(true) : merge())}>Merge</Button>
      </div>
      <MergeDialog a={a} b={b} open={asking} onOpenChange={setAsking} onConfirm={(name) => merge(name)} />
    </div>
  );
}

export function MergeSuggestions() {
  const { contacts, suggestions } = useContactsData();
  const query = useSearchParams().toString();
  const rows = useMemo(() => {
    const byId = new Map((contacts ?? []).map((c) => [c.id, c]));
    return (suggestions ?? []).flatMap((s) => {
      const a = byId.get(s.contactA);
      const b = byId.get(s.contactB);
      return a && b ? [{ s, a, b }] : [];
    });
  }, [contacts, suggestions]);
  const loading = contacts === undefined || suggestions === undefined;

  return (
    <DetailPage
      backHref={withQuery("/contacts", query)}
      className="flex flex-col gap-3"
      header={
        <div className="flex h-10 min-w-0 flex-1 flex-col justify-center">
          <span className="truncate text-sm font-medium">Suggested Merges</span>
          {!loading && rows.length > 0 && <span className="truncate text-xs text-muted-foreground">People who may be the same person</span>}
        </div>
      }
    >
      {loading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 w-full rounded-lg" />)}
      {!loading && rows.length === 0 && (
        <div className="py-24">
          {suggestions === null || contacts === null ? (
            <EmptyState icon={Users} title="Suggestions Did Not Load" description="Check your connection, then reload." />
          ) : (
            <EmptyState icon={Users} title="No Suggested Merges" description="When two contacts look like the same person, they show here." />
          )}
        </div>
      )}
      {rows.map(({ s, a, b }) => (
        <SuggestionCard key={s.id} suggestion={s} a={a} b={b} query={query} />
      ))}
    </DetailPage>
  );
}
