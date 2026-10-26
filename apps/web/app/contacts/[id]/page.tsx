"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { getContact, type ContactDetail } from "@/lib/contacts";
import { resolveMergedContact } from "@/lib/contact-merging";
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
  const { contactsVersion } = useApp();
  // undefined while loading, null when there is no such contact, failed when it could not be read.
  const [contact, setContact] = useState<{ id: string; detail: ContactDetail | null; failed?: boolean } | undefined>(undefined);
  // Bumped by Retry.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await getContact(id);
        if (cancelled) return;
        if (detail) {
          setContact({ id, detail });
          return;
        }
        // A contact merged into another opens the one it became.
        const kept = await resolveMergedContact(id);
        if (cancelled) return;
        if (kept) router.replace(withQuery(`/contacts/${kept}`, query));
        else setContact({ id, detail: null });
      } catch (err) {
        console.error(err instanceof Error ? err.message : "Load contact failed");
        if (!cancelled) setContact({ id, detail: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, userId, contactsVersion, router, query, attempt]);

  const backHref = withQuery("/contacts", query);
  if (!contact || contact.id !== id) return <DetailSkeleton backHref={backHref} />;
  if (contact.failed) {
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
      <ContactView contact={contact.detail} />
    </Suspense>
  );
}
