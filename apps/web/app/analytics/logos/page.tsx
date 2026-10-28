"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth, useIsOwner } from "@/lib/auth";
import { chooseLogo, loadCompanyLogos, rejectLogo, SOURCE_LABELS, type CompanyLogo, type LogoCandidate } from "@/lib/company-logos";
import { useSignedUrl } from "@/lib/signed-urls";
import { CompanyAvatar } from "@/components/primitives";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CountTile, EmptyState, Loading, money, Tile, Tiles } from "@/components/analytics/parts";

// The owner's review of the shared company logos: each company's chosen logo, where it came from and the
// judge's reason. Rejecting one searches again without it, and choosing a candidate by hand keeps it;
// both apply to every user. The workers do the work: an action here only queues it.

const FILTERS = { all: "All Companies", letter: "No Logo", changed: "Changed Recently", waiting: "Waiting", manual: "Chosen by Hand" } as const;
type Filter = keyof typeof FILTERS;
const RECENT_MS = 14 * 24 * 60 * 60_000;

const STATUS_LABELS: Record<CompanyLogo["status"], string> = { queued: "Gathering", judging: "Judging", judged: "Saving", searching: "Searching", done: "Done" };

function matches(logo: CompanyLogo, filter: Filter, now: number): boolean {
  if (filter === "letter") return logo.status === "done" && !logo.path;
  if (filter === "changed") return !!logo.changedAt && now - Date.parse(logo.changedAt) < RECENT_MS;
  if (filter === "waiting") return logo.status !== "done";
  if (filter === "manual") return logo.manual;
  return true;
}

/** One framed candidate as the round avatar it would be. */
function CandidateImage({ path, size }: { path: string; size: "size-10" | "size-20" }) {
  const url = useSignedUrl("logos", path) ?? undefined;
  return <Avatar className={size}>{url && <AvatarImage src={url} alt="" className="object-cover" />}</Avatar>;
}

function Candidates({ logo, onClose, onChanged }: { logo: CompanyLogo; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  // Turned down in this round, by number; the first round's are kept apart when a search followed.
  const current = new Set(logo.candidates.map((c) => c.path));
  const reasons = new Map(logo.rejected.filter((r) => !r.path || current.has(r.path)).map((r) => [r.n, r.reason]));
  const firstLook = logo.rejected.filter((r) => r.path && !current.has(r.path));
  const act = async (what: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast(done);
      onChanged();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{logo.name}</DialogTitle>
        <DialogDescription>
          {logo.domain}. Every candidate from the latest {logo.round === 2 ? "search" : "look"}, framed as it would show, with the judge&apos;s reason.
        </DialogDescription>
      </DialogHeader>
      <ScrollArea className="max-h-[60vh]">
        <ItemGroup className="gap-2 pr-3">
          {logo.candidates.length === 0 && <p className="text-sm text-muted-foreground">No candidates were found.</p>}
          {logo.candidates.map((c: LogoCandidate) => {
            const chosen = c.n === logo.pick && logo.status === "done" && !!logo.path;
            return (
              <Item key={c.n} variant="outline" size="sm">
                <ItemMedia>
                  <div className="flex items-center gap-2">
                    <CandidateImage path={c.path} size="size-20" />
                    <CandidateImage path={c.path} size="size-10" />
                  </div>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    {c.n}. {SOURCE_LABELS[c.source]}
                    {chosen && <Badge variant="secondary">Chosen</Badge>}
                  </ItemTitle>
                  <ItemDescription>{chosen ? logo.verdict : (reasons.get(c.n) ?? c.note ?? "")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  {chosen ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => rejectLogo(logo.domain, c.n), "Searching again without it.")}>Reject</Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => chooseLogo(logo.domain, c.n), "Saved for every user.")}>Use This</Button>
                  )}
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
        {logo.round === 2 && firstLook.length > 0 && (
          <>
            <h3 className="mt-4 mb-2 text-sm font-medium">First Look, Before Searching</h3>
            <ItemGroup className="gap-2 pr-3">
              {firstLook.map((r) => (
                <Item key={r.path} variant="outline" size="sm">
                  <ItemMedia><CandidateImage path={r.path!} size="size-10" /></ItemMedia>
                  <ItemContent>
                    <ItemTitle>{r.source ? SOURCE_LABELS[r.source] : "Unknown"}</ItemTitle>
                    <ItemDescription>{r.reason}</ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </>
        )}
      </ScrollArea>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Logos() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = useIsOwner();
  const [logos, setLogos] = useState<CompanyLogo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<CompanyLogo | null>(null);

  useEffect(() => {
    if (session && !isOwner) router.replace("/inbox");
  }, [session, isOwner, router]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      setLogos(await loadCompanyLogos());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (isOwner) void refresh();
  }, [isOwner, refresh]);

  const now = Date.now();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (logos ?? []).filter((l) => matches(l, filter, now) && (!q || l.name.toLowerCase().includes(q) || l.domain.includes(q)));
  }, [logos, filter, query, now]);
  const stats = useMemo(() => {
    const all = logos ?? [];
    const done = all.filter((l) => l.status === "done");
    const bySource = new Map<string, number>();
    for (const l of done) if (l.path && l.source) bySource.set(SOURCE_LABELS[l.source], (bySource.get(SOURCE_LABELS[l.source]) ?? 0) + 1);
    return {
      total: all.length,
      done: done.length,
      letters: done.filter((l) => !l.path).length,
      calls: all.reduce((s, l) => s + l.geminiCalls, 0),
      cost: all.reduce((s, l) => s + l.geminiCostUsd, 0),
      sources: [...bySource].sort((a, b) => b[1] - a[1]),
    };
  }, [logos]);

  if (!isOwner) {
    return session ? (
      <div className="w-full max-w-4xl p-3">
        <EmptyState title="Owner Only">Company logos are only for the owner of this app to review.</EmptyState>
      </div>
    ) : null;
  }
  const current = logos?.find((l) => l.domain === open) ?? null;

  const reject = async (logo: CompanyLogo) => {
    try {
      await rejectLogo(logo.domain, null);
      toast("Searching again without it.");
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setRejecting(null);
  };

  return (
    <ScrollArea className="h-full">
      <div className="w-full max-w-4xl p-3">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex h-10 items-center text-lg font-medium">Company Logos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              One logo for each company, shared by every user. Only company names and domains leave Konva to find them. <Link href="/analytics" className="underline underline-offset-4">Back to Analytics</Link>
            </p>
          </div>
          <Button variant="outline" size="icon" aria-label="Refresh" disabled={busy} onClick={() => void refresh()}><RefreshCw className={busy ? "animate-spin" : undefined} /></Button>
        </div>
        {failed && (
          <Alert variant="destructive" className="mb-6">
            <AlertTitle>Could Not Load The Logos</AlertTitle>
            <AlertDescription>Check your connection and try again.</AlertDescription>
            <AlertAction><Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>Retry</Button></AlertAction>
          </Alert>
        )}
        {!logos ? (
          failed ? null : <Loading />
        ) : (
          <div className="space-y-6">
            <Tiles>
              <Tile label="Companies" value={String(stats.total)} note={`${stats.total - stats.done} Waiting`} />
              <CountTile label="With a Logo" part={stats.done - stats.letters} whole={stats.done} />
              <CountTile label="First Letter" part={stats.letters} whole={stats.done} />
              <Tile label="Gemini Cost" value={money(stats.cost)} note={`${stats.calls} Calls, Latest Runs`} />
            </Tiles>
            {stats.sources.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {stats.sources.map(([label, n]) => <Badge key={label} variant="outline">{label}: {n}</Badge>)}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input placeholder="Search Companies" value={query} onChange={(e) => setQuery(e.target.value)} className="sm:max-w-xs" aria-label="Search Companies" />
              <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                <SelectTrigger className="w-44" aria-label="Show"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(FILTERS) as Filter[]).map((f) => <SelectItem key={f} value={f}>{FILTERS[f]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {shown.length === 0 ? (
              <EmptyState title="No Companies">Nothing matches this filter.</EmptyState>
            ) : (
              <ItemGroup className="gap-2">
                {shown.map((l) => (
                  <Item key={l.domain} variant="outline" size="sm">
                    <ItemMedia>
                      <CompanyAvatar logoPath={l.path} className="size-10" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {l.name}
                        {l.status !== "done" ? (
                          <Badge variant="outline">{STATUS_LABELS[l.status]}</Badge>
                        ) : l.path && l.source ? (
                          <Badge variant="secondary">{SOURCE_LABELS[l.source]}</Badge>
                        ) : (
                          <Badge variant="outline">First Letter</Badge>
                        )}
                        {l.manual && <Badge variant="outline">Chosen by Hand</Badge>}
                      </ItemTitle>
                      <ItemDescription>{l.domain}{l.verdict ? `. ${l.verdict}` : ""}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button size="sm" variant="outline" onClick={() => setOpen(l.domain)}>Candidates</Button>
                      {l.path && <Button size="sm" variant="ghost" onClick={() => setRejecting(l)}>Reject</Button>}
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </div>
        )}
      </div>
      <Dialog open={!!current} onOpenChange={(o) => !o && setOpen(null)}>
        {current && <Candidates logo={current} onClose={() => setOpen(null)} onChanged={() => void refresh()} />}
      </Dialog>
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        {rejecting && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject This Logo?</DialogTitle>
              <DialogDescription>
                {rejecting.name}&apos;s logo will be looked for again without it, and it is never offered again. Every user sees the new one.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
              <Button onClick={() => void reject(rejecting)}>Reject</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ScrollArea>
  );
}

export default function CompanyLogosPage() {
  return (
    <Suspense>
      <Logos />
    </Suspense>
  );
}
