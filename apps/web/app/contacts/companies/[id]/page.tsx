"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getCompany, type CompanyDetail } from "@/lib/organizations";
import { CompanyView } from "@/components/company-view";

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  // undefined while loading, null when there is no such company.
  const [company, setCompany] = useState<{ id: string; detail: CompanyDetail | null } | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getCompany(id)
      .then((detail) => !cancelled && setCompany({ id, detail }))
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load company failed");
        if (!cancelled) setCompany({ id, detail: null });
      });
    return () => {
      cancelled = true;
    };
  }, [id, userId]);

  // Like a contact, nothing shows until the company has loaded.
  if (!company || company.id !== id) return null;
  return (
    <Suspense fallback={null}>
      <CompanyView key={id} company={company.detail} />
    </Suspense>
  );
}
