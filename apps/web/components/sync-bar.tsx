"use client";

// The bar above every page while a new user's accounts are doing their first import, and the hook that lists which ones.

import { RefreshCw } from "lucide-react";
import { useApp } from "@/lib/store";
import { useOnboardingMeta } from "@/lib/onboarding";

/**
 * The accounts still bringing in their first messages, by name: connecting with a sign-in, or importing.
 * A WhatsApp link waiting for its code to be scanned is not importing yet, so it is left out.
 */
export function useImporting(): string[] {
  const { accounts } = useApp();
  const labels = accounts
    .filter((a) => a.status === "syncing" || (a.status === "connecting" && a.provider !== "whatsapp"))
    .map((a) => a.label);
  return [...new Set(labels)];
}

function listOf(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A line above every page while a new user's accounts import, so empty pages read as on their way, not empty. */
export function SyncBar() {
  const { threads, loading } = useApp();
  const { onboarding } = useOnboardingMeta();
  const importing = useImporting();
  if (onboarding !== "done" || loading || importing.length === 0) return null;
  const count = threads.length;
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
      <RefreshCw className="size-3 shrink-0 animate-spin" />
      <span className="min-w-0 truncate">
        Importing {listOf(importing)}.{count > 0 && ` ${count.toLocaleString()} ${count === 1 ? "conversation" : "conversations"} so far.`}
      </span>
    </div>
  );
}
