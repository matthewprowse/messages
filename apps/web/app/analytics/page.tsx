"use client";

// Analytics is part of Admin now: an old link or bookmark lands on the matching Admin view (?tab=health is Overview,
// usage is Usage, ai is AI), keeping its period and owner switch. Admin does the owner gating.

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { adminHrefFromAnalytics } from "@/components/admin/view-params";

function ToAdmin() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => { router.replace(adminHrefFromAnalytics(new URLSearchParams(params.toString()))); }, [router, params]);
  return null;
}

export default function AnalyticsPage() {
  return (
    <Suspense>
      <ToAdmin />
    </Suspense>
  );
}
