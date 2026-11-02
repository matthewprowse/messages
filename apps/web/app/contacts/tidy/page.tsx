"use client";

// Tidy Up (/contacts/tidy) in the right-hand pane: duplicates to review and contacts that need a name.

import { Suspense } from "react";
import { TidyUp } from "@/components/contacts/tidy-up";

export default function TidyPage() {
  return (
    <Suspense fallback={null}>
      <TidyUp />
    </Suspense>
  );
}
