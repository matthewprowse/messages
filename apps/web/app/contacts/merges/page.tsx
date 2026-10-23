"use client";

import { Suspense } from "react";
import { MergeSuggestions } from "@/components/merge-suggestions";

export default function MergesPage() {
  return (
    <Suspense fallback={null}>
      <MergeSuggestions />
    </Suspense>
  );
}
