"use client";

// The changelog route, kept so old links work. The page now lives as the Updates tab in Admin (the owner reaches it from
// there); this route shows the same list on its own. Owner only: the database refuses the rows to anyone else.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useIsOwner } from "@/lib/auth";
import { PaneHeader } from "@/components/pane";
import { UpdatesPanel } from "@/components/updates/updates-panel";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function UpdatesPage() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = useIsOwner();

  useEffect(() => {
    if (session && !isOwner) router.replace("/inbox");
  }, [session, isOwner, router]);

  if (!isOwner) return null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0"><PaneHeader title="Updates" /></div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl p-3 md:px-4"><UpdatesPanel /></div>
      </ScrollArea>
    </div>
  );
}
