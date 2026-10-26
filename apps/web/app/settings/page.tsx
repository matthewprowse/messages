"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { EmptyState } from "@/components/primitives";

// On a phone this is the list of sections (drawn by the layout). From tablet width up the list is always beside a
// section, so the first one opens straight away.
export default function SettingsIndex() {
  const router = useRouter();
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    const go = () => { if (wide.matches) router.replace("/settings/accounts"); };
    go();
    wide.addEventListener("change", go);
    return () => wide.removeEventListener("change", go);
  }, [router]);
  return (
    <div className="hidden h-[70vh] items-center justify-center md:flex">
      <EmptyState icon={Settings2} title="Pick a Section" description="Accounts, personalisation, notifications and general settings." />
    </div>
  );
}
