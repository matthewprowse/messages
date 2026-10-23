"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { getContact, type ContactDetail } from "@/lib/contacts";
import { resolveMergedContact } from "@/lib/contact-merging";
import { ContactView } from "@/components/contact-view";

export default function ContactPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const query = useSearchParams().toString();
  const { session } = useAuth();
  const userId = session?.user.id;
  // A merge, split or undo reloads the open contact.
  const { contactsVersion } = useApp();
  // undefined while loading, null when there is no such contact.
  const [contact, setContact] = useState<{ id: string; detail: ContactDetail | null } | undefined>(undefined);

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
        if (kept) router.replace(`/contacts/${kept}${query ? `?${query}` : ""}`);
        else setContact({ id, detail: null });
      } catch (err) {
        console.error(err instanceof Error ? err.message : "Load contact failed");
        if (!cancelled) setContact({ id, detail: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, userId, contactsVersion, router, query]);

  // Like a conversation, nothing shows until the contact has loaded.
  if (!contact || contact.id !== id) return null;
  return (
    <Suspense fallback={null}>
      <ContactView contact={contact.detail} />
    </Suspense>
  );
}
