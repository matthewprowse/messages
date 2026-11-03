"use client";

// Company Logos is a view of Admin now: an old link or bookmark lands on it. Admin does the owner gating.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CompanyLogosPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/admin?view=logos"); }, [router]);
  return null;
}
