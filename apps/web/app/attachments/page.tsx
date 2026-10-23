"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Paperclip, Search } from "lucide-react";
import { loadAttachments } from "@/lib/data";
import { useApp } from "@/lib/store";
import type { Attachment, FiledAttachment } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { EmptyState } from "@/components/primitives";
import { AttachmentGrid } from "@/components/attachments";

type Kind = "all" | "image" | "pdf" | "file";

const KINDS: { key: Kind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "pdf", label: "PDFs" },
  { key: "file", label: "Files" },
];

// Files covers everything that is not a picture or a PDF, videos included.
const matchesKind = (kind: Kind, a: Attachment) => kind === "all" || a.kind === kind || (kind === "file" && a.kind === "video");

function AttachmentsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { contactById } = useApp();
  const raw = params.get("kind") as Kind | null;
  const kind: Kind = raw && KINDS.some((k) => k.key === raw) ? raw : "all";
  const [showHidden, setShowHidden] = useState(false);
  const [query, setQuery] = useState("");
  // null while loading, false if it failed.
  const [files, setFiles] = useState<FiledAttachment[] | null | false>(null);

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    loadAttachments(showHidden).then(
      (next) => { if (!cancelled) setFiles(next); },
      (err) => {
        console.error(err);
        if (!cancelled) setFiles(false);
      },
    );
    return () => { cancelled = true; };
  }, [showHidden]);

  // Built once per load, not on every keystroke.
  const searchText = useMemo(() => {
    const text = new Map<string, string>();
    for (const a of files || []) {
      const contact = a.from === "me" ? undefined : contactById(a.from);
      text.set(a.id, [a.name, a.from === "me" ? "you" : contact?.name, ...(contact?.emails ?? [])].join(" ").toLowerCase());
    }
    return text;
  }, [files, contactById]);

  const shown = useMemo(() => {
    if (!files) return [];
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return files.filter((a) => {
      if (!matchesKind(kind, a)) return false;
      const haystack = searchText.get(a.id) ?? "";
      return words.every((w) => haystack.includes(w));
    });
  }, [files, kind, query, searchText]);

  const kindLabel = KINDS.find((k) => k.key === kind)?.label;

  return (
    // Same floating header as the Conversations and Contacts lists; the scrollbar starts below it.
    <ScrollArea className="h-full" scrollbarClassName="data-vertical:top-[104px]! data-vertical:h-auto!">
      <div className="sticky top-0 z-10 space-y-2 bg-background/70 p-3 backdrop-blur-xl backdrop-saturate-150">
        <div className="flex h-10 items-center justify-between gap-3">
          <h1 className="text-lg font-medium">Attachments</h1>
          <InputGroup className="max-w-64 min-w-0 flex-1">
            <InputGroupAddon><Search /></InputGroupAddon>
            <InputGroupInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search by Name or Sender" />
          </InputGroup>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Tabs value={kind} onValueChange={(v) => router.push(v === "all" ? "/attachments" : `/attachments?kind=${v}`)}>
            <TabsList aria-label="Type">
              {KINDS.map((k) => (
                <TabsTrigger key={k.key} value={k.key} className="px-3">{k.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex shrink-0 items-center gap-2">
            <Switch id="show-hidden" checked={showHidden} onCheckedChange={setShowHidden} />
            <Label htmlFor="show-hidden" className="text-sm font-normal whitespace-nowrap text-muted-foreground">Show Hidden</Label>
          </div>
        </div>
      </div>
      <div className="px-3 pb-3">
        {files === null && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-3 gap-y-4" aria-label="Loading attachments">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1">
                <Skeleton className="aspect-square w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        )}
        {files === false && (
          <div className="py-24">
            <EmptyState icon={Paperclip} title="Attachments Did Not Load" description="Check your connection, then reload." />
          </div>
        )}
        {files && shown.length === 0 && (
          <div className="py-24">
            {query.trim() ? (
              <EmptyState icon={Search} title="No Matches" description="Try another file name or sender." />
            ) : (
              <EmptyState
                icon={Paperclip}
                title={kind === "all" ? "No Attachments Yet" : `No ${kindLabel}`}
                description="Files from your conversations appear here as your accounts sync."
              />
            )}
          </div>
        )}
        {shown.length > 0 && <AttachmentGrid items={shown} />}
      </div>
    </ScrollArea>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AttachmentsPage />
    </Suspense>
  );
}
