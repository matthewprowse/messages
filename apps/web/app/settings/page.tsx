"use client";

import { Settings2 } from "lucide-react";
import { EmptyState } from "@/components/primitives";

export default function SettingsIndex() {
  return (
    <div className="hidden h-[70vh] items-center justify-center md:flex">
      <EmptyState icon={Settings2} title="Pick a Section" description="Accounts, personalisation, notifications and general settings." />
    </div>
  );
}
