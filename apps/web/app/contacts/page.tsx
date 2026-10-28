"use client";

// Contacts index: the empty right-hand pane on desktop, with a prompt only on the Companies view.

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";
import { EmptyState } from "@/components/primitives";

function Placeholder() {
  const companies = useSearchParams().get("view") === "companies";
  return companies ? (
    <EmptyState icon={Building2} title="Pick a Company" description="People who write from the same work domain, with every conversation from them." />
  ) : null;
}

export default function ContactsIndex() {
  return (
    <div className="hidden h-full items-center justify-center md:flex">
      <Suspense fallback={null}>
        <Placeholder />
      </Suspense>
    </div>
  );
}
