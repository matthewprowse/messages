"use client";

// A quiet link at the top of the Subscriptions list that opens Clean Up.

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CleanUpLink() {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2">
      <span className="text-xs text-muted-foreground">Senders you never open</span>
      <Button asChild variant="secondary"><Link href="/inbox/clean-up"><Sparkles />Clean Up</Link></Button>
    </div>
  );
}
