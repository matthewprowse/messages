"use client";

// The readable version of a newsletter, marketing or notification email, shown in place of its trimmed preview. It is made by
// the AI worker only when the email scrolls into view (lib/bulk-read.ts asks and waits). While it is made a skeleton shows,
// and if it cannot be made the usual preview stays with a Retry. Plain text only: the sender's HTML never reaches the page.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { FIELD } from "@messages/crypto/fields";
import { track } from "@/lib/analytics";
import { loadBulkRead, parseBulkRead, type BulkApi, type BulkOutcome } from "@/lib/bulk-read";
import { supabase } from "@/lib/supabase";
import { open as openText } from "@/lib/vault";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** The calls behind loadBulkRead: the stored version and the request row, read and written as the signed-in person. */
const api: BulkApi = {
  async stored(messageId) {
    const { data, error } = await supabase.from("message_ai").select("bulk_read").eq("message_id", messageId).maybeSingle();
    if (error || !data?.bulk_read) return null;
    return parseBulkRead(await openText(FIELD.bulkRead, data.bulk_read));
  },
  async request(messageId, again) {
    // A failed request is the only kind a person may remove; for any other this does nothing.
    if (again) await supabase.from("bulk_reads").delete().eq("message_id", messageId).not("error", "is", null);
    const { error } = await supabase.from("bulk_reads").insert({ message_id: messageId });
    return !error || error.code === "23505"; // already asked: the worker has it
  },
  async failure(messageId) {
    const { data } = await supabase.from("bulk_reads").select("error").eq("message_id", messageId).maybeSingle();
    return data?.error ?? null;
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  visible: () => document.visibilityState === "visible",
};

/** True once the element has been on screen, so a long thread of bulk mail only reads the emails someone looks at. */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setSeen(true); });
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);
  return { ref, seen };
}

/** `fallback` is the existing trimmed preview, shown while there is nothing better and when the version could not be made. */
export function BulkRead({ messageId, fallback }: { messageId: string; fallback: ReactNode }) {
  const { ref, seen } = useSeen<HTMLDivElement>();
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<{ id: string; tries: number; outcome: BulkOutcome } | null>(null);
  useEffect(() => {
    if (!seen) return;
    let stopped = false;
    void loadBulkRead(api, messageId, tries > 0, () => stopped).then((outcome) => {
      if (!outcome || stopped) return;
      setResult({ id: messageId, tries, outcome });
      track("feature_used", { feature: "bulk_read", detail: outcome.kind === "ready" ? "shown" : "failed" });
    });
    return () => { stopped = true; };
  }, [seen, messageId, tries]);
  const mine = result?.id === messageId && result.tries === tries ? result.outcome : null;

  if (mine?.kind === "ready") {
    const { summary, points, links } = mine.read;
    return (
      <div ref={ref} className="flex flex-col items-start gap-2">
        <p className="wrap-anywhere">{summary}</p>
        {points.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {points.map((p, i) => <li key={`${i}-${p}`} className="wrap-anywhere">{p}</li>)}
          </ul>
        )}
        {links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {links.map((l, i) => (
              <Button key={`${i}-${l.url}`} variant="outline" asChild>
                {/* The label is the AI's words about a stranger's email, so the real site sits beside it at full size and a long label is cut, never the site. */}
                <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" title={l.url} aria-label={`${l.label}, Opens ${l.host}`}>
                  <span className="max-w-48 truncate">{l.label}</span>
                  <span className="font-normal text-muted-foreground">{l.host}</span>
                  <ExternalLink />
                </a>
              </Button>
            ))}
          </div>
        )}
        <Badge variant="secondary" className="text-xs">Summarised by AI</Badge>
      </div>
    );
  }
  if (mine?.kind === "error") {
    return (
      <div ref={ref} className="flex flex-col items-start gap-2">
        {fallback}
        <div className="flex flex-wrap items-center gap-2 text-xs opacity-70">
          <span>{mine.message}</span>
          {mine.retry && <Button variant="ghost" onClick={() => setTries((n) => n + 1)}>Retry</Button>}
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} className="flex w-full flex-col gap-2" aria-busy={seen}>
      {seen ? (
        <>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </>
      ) : fallback}
    </div>
  );
}
