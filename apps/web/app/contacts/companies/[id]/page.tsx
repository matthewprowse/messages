"use client";

// One company (/contacts/companies/[id]) in the right-hand pane. Reloads when one of its people is merged, split or deleted, and offers Retry when the read fails.

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { getCompany, type CompanyDetail } from "@/lib/organizations";
import { CompanyView } from "@/components/company-view";
import { DetailSkeleton, LoadFailed } from "@/components/contact-list";

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const query = useSearchParams().toString();
  // Merging, splitting or deleting one of its people reloads the open company.
  const { contactsVersion } = useApp();
  // undefined while loading, null when there is no such company, failed when it could not be read.
  const [company, setCompany] = useState<{ id: string; detail: CompanyDetail | null; failed?: boolean } | undefined>(undefined);
  // Bumped by Retry.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getCompany(id)
      .then((detail) => !cancelled && setCompany({ id, detail }))
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load company failed");
        if (!cancelled) setCompany({ id, detail: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [id, userId, contactsVersion, attempt]);

  const backHref = `/contacts?${query || "view=companies"}`;
  if (!company || company.id !== id) return <DetailSkeleton backHref={backHref} />;
  if (company.failed) {
    return (
      <LoadFailed
        icon={Building2}
        title="Company Did Not Load"
        backHref={backHref}
        backLabel="Back to Companies"
        onRetry={() => {
          setCompany(undefined);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return (
    <Suspense fallback={null}>
      <CompanyView key={id} company={company.detail} />
    </Suspense>
  );
}
