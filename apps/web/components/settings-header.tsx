"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SettingsHeader({ title, description, back = "/settings", actions }: { title: string; description?: React.ReactNode; back?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <Button variant="ghost" size="sm" className="-ml-2 mb-2 md:hidden" asChild><Link href={back}><ArrowLeft /> Back</Link></Button>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex h-10 items-center text-lg font-medium">{title}</h1>
          {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions}
      </div>
    </div>
  );
}
