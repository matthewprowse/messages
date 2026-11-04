"use client";

// One contact (/contacts/[id]) in the right-hand pane. Reloads when a merge, split or undo changes it, and offers Retry when the read fails.
// Someone opened before shows at once from memory and is read again underneath when old; someone new is drawn at once
// from the Contacts list and the store (partial), and the rest fills in when the read lands (lib/contact-detail-cache.ts).

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import type { ContactDetail } from "@/lib/contacts";
import { getContact } from "@/lib/contact-detail";
import { resolveMergedContact } from "@/lib/contact-merging";
import { cacheContact, cachedContact, forgetContact, isContactFresh, provisionalContact } from "@/lib/contact-detail-cache";
import { useContactsData } from "@/components/contacts-data";
import { Users } from "lucide-react";
import { ContactView } from "@/components/contact-view";
import { DetailSkeleton, LoadFailed } from "@/components/contact-list";
import { withQuery } from "@/lib/utils";

export default function ContactPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const query = useSearchParams().toString();
  const { session } = useAuth();
  const userId = session?.user.id;
  // A merge, split or undo reloads the open contact.
  const { contactsVersion, contactChanges, contacts: stored, threads } = useApp();
  const changes = contactChanges.length;
  const { contacts: listed } = useContactsData();
  // undefined while loading, null when there is no such contact, failed when it could not be read.
  const [contact, setContact] = useState<{ id: string; detail: ContactDetail | null; failed?: boolean } | undefined>(undefined);
  // Bumped by Retry.
  const [attempt, setAttempt] = useState(0);
  const held = contact && contact.id === id ? contact : undefined;
  // Until this contact's read lands: their kept page, or one drawn from what the list and the store hold.
  const early = useMemo(() => {
    if (held) return null;
    return cachedContact(userId, id)?.detail ?? provisionalContact(id, listed?.find((c) => c.id === id), stored.find((c) => c.id === id), threads);
  }, [held, userId, id, listed, stored, threads]);

  useEffect(() => {
    if (!userId) return;
    // A young kept page with no contact change since needs no read; Retry always reads.
    if (attempt === 0 && isContactFresh(userId, id, { version: contactsVersion, changes })) {
      setContact({ id, detail: cachedContact(userId, id)!.detail });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const detail = await getContact(id);
        if (cancelled) return;
        if (detail) {
          cacheContact(userId, id, { detail, version: contactsVersion, changes });
          setContact({ id, detail });
          return;
        }
        forgetContact(userId, id);
        // A contact merged into another opens the one it became.
        const kept = await resolveMergedContact(id);
        if (cancelled) return;
        if (kept) router.replace(withQuery(`/contacts/${kept}`, query));
        else setContact({ id, detail: null });
      } catch (err) {
        console.error(err instanceof Error ? err.message : "Load contact failed");
        if (cancelled) return;
        // A kept page already on screen stays when reading it again fails; only a first read reports the failure.
        const kept = cachedContact(userId, id);
        setContact(kept ? { id, detail: kept.detail } : { id, detail: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
    // changes is read, not watched: a change to someone else should not read this page again while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, userId, contactsVersion, router, query, attempt]);

  const backHref = withQuery("/contacts", query);
  if (!held) return early ? <Suspense fallback={null}><ContactView contact={early} /></Suspense> : <DetailSkeleton backHref={backHref} />;
  if (held.failed) {
    return (
      <LoadFailed
        icon={Users}
        title="Contact Did Not Load"
        backHref={backHref}
        backLabel="Back to Contacts"
        onRetry={() => {
          setContact(undefined);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return (
    <Suspense fallback={null}>
      <ContactView contact={held.detail} />
    </Suspense>
  );
}
