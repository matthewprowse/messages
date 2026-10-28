"use client";

// The merge suggestions view of Contacts (/contacts/merges). The list itself is MergeSuggestions, wrapped in Suspense.

import { Suspense } from "react";
import { MergeSuggestions } from "@/components/merge-suggestions";

export default function MergesPage() {
  return (
    <Suspense fallback={null}>
      <MergeSuggestions />
    </Suspense>
  );
}
