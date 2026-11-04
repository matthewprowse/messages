"use client";

// Admin's Logos view, the owner's review of the shared company logos (once its own page at /analytics/logos): how many
// companies have one, where they came from, and each company's chosen logo with the judge's reason. Rejecting one searches
// again without it and choosing a candidate by hand keeps it; both apply to every user. Only company names and domains
// leave Konva to find them. The search is the page header's; the filter is in the list card's title row. To Review (the
// companies left on a first letter, until one is chosen by hand) is what the page opens on when any wait.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { loadCompanyLogos, rejectLogo, SOURCE_LABELS, type CompanyLogo } from "@/lib/company-logos";
import { CompanyAvatar } from "@/components/primitives";
import { PaneSelect } from "@/components/pane";
import { Card, Row, Separated } from "@/components/surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { spend } from "@/lib/ai-features";
import { num } from "./format";
import { CountStat, Failed, LoadingCards, Quiet, Stat, Stats } from "./parts";
import { Table } from "./table";
import { CandidatesDialog, RejectLogoDialog } from "./logo-candidates";

const FILTERS = { review: "To Review", all: "All Companies", letter: "No Logo", changed: "Changed Recently", waiting: "Waiting", manual: "Chosen By Hand" } as const;
type Filter = keyof typeof FILTERS;
const RECENT_MS = 14 * 24 * 60 * 60_000;

const STATUS_LABELS: Record<CompanyLogo["status"], string> = { queued: "Gathering", judging: "Judging", judged: "Saving", searching: "Searching", done: "Done" };

/**
 * A company the AI found no logo for and nobody has chosen one by hand: it shows a first letter to every user. Recently
 * changed logos are not counted, since nearly every logo was found in the last fortnight; they have their own filter.
 */
const needsReview = (logo: CompanyLogo) => logo.status === "done" && !logo.manual && !logo.path;

function matches(logo: CompanyLogo, filter: Filter, now: number): boolean {
  if (filter === "review") return needsReview(logo);
  if (filter === "letter") return logo.status === "done" && !logo.path;
  if (filter === "changed") return !!logo.changedAt && now - Date.parse(logo.changedAt) < RECENT_MS;
  if (filter === "waiting") return logo.status !== "done";
  if (filter === "manual") return logo.manual;
  return true;
}

/** Loads on mount and whenever `version` changes (the header Refresh). `query` is the header search. */
export function Logos({ version, query, onBusy }: { version: number; query: string; onBusy: (busy: boolean) => void }) {
  const [logos, setLogos] = useState<CompanyLogo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Unset until the logos load, then To Review when anything needs it and All Companies otherwise.
  const [picked, setPicked] = useState<Filter | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<CompanyLogo | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    onBusy(true);
    setFailed(false);
    try {
      setLogos(await loadCompanyLogos());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }, [onBusy]);
  useEffect(() => { void refresh(); }, [refresh, version]);

  const now = Date.now();
  const toReview = useMemo(() => (logos ?? []).filter(needsReview).length, [logos]);
  const filter: Filter = picked ?? (toReview > 0 ? "review" : "all");
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
      sources: [...bySource].sort((a, b) => b[1] - a[1]).map(([source, n]) => ({ source, n })),
    };
  }, [logos]);

  const reject = async (logo: CompanyLogo) => {
    setRejecting(null);
    try {
      await rejectLogo(logo.domain, null);
      toast("Searching Again Without It");
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!logos) return failed ? <Failed title="Could Not Load The Logos" busy={busy} onRetry={() => void refresh()} /> : <LoadingCards />;
  const filterPicker = <PaneSelect label="Show" value={filter} onChange={(v) => setPicked(v as Filter)} options={(Object.keys(FILTERS) as Filter[]).map((f) => ({ value: f, label: f === "review" ? `To Review (${toReview})` : FILTERS[f] }))} className="w-44" />;
  return (
    <>
      {failed && <Failed title="Could Not Load The Logos" busy={busy} onRetry={() => void refresh()} />}
      <Stats>
        <Stat label="To Review" value={num(toReview)} alert={toReview > 0} note={toReview > 0 ? "First Letter, No Logo Found" : "Every Company Has A Logo"} />
        <Stat label="Companies" value={num(stats.total)} note={`${num(stats.total - stats.done)} Waiting`} />
        <CountStat label="With A Logo" part={stats.done - stats.letters} whole={stats.done} />
        <Stat label="Gemini Cost" value={spend(stats.cost)} note={`${num(stats.calls)} Calls, Latest Runs`} />
      </Stats>
      <Card title={filter === "review" ? `To Review, ${num(toReview)}` : "Companies"} action={filterPicker}>
        {filter === "review" && <Quiet>The AI found no logo for these, so every user sees a first letter. Open Candidates and choose one with Use This to take it off this list.</Quiet>}
        {shown.length === 0 ? <Quiet>{filter === "review" ? "Nothing To Review" : "Nothing Matches"}</Quiet> : (
          <Separated>
            {shown.map((l) => (
              <Row
                key={l.domain}
                lead={<CompanyAvatar logoPath={l.path} className="size-10" />}
                title={
                  <>
                    {l.name}
                    {l.status !== "done" ? (
                      <Badge variant="outline" className="ml-2">{STATUS_LABELS[l.status]}</Badge>
                    ) : l.path && l.source ? (
                      <Badge variant="secondary" className="ml-2">{SOURCE_LABELS[l.source]}</Badge>
                    ) : (
                      <Badge variant="outline" className="ml-2">First Letter</Badge>
                    )}
                    {l.manual && <Badge variant="outline" className="ml-2">Chosen By Hand</Badge>}
                  </>
                }
                detail={`${l.domain}${l.verdict ? `. ${l.verdict}` : ""}`}
                end={
                  <>
                    {l.path && <Button variant="ghost" onClick={() => setRejecting(l)}>Reject</Button>}
                    <Button variant="secondary" onClick={() => setOpen(l.domain)}>Candidates</Button>
                  </>
                }
              />
            ))}
          </Separated>
        )}
      </Card>
      {stats.sources.length > 0 && (
        <Card title="Sources">
          <Table rows={stats.sources} cols={[{ head: "Source", cell: (s) => s.source }, { head: "Companies", cell: (s) => num(s.n), num: true }]} />
        </Card>
      )}
      <CandidatesDialog logo={logos.find((l) => l.domain === open) ?? null} onClose={() => setOpen(null)} onChanged={() => void refresh()} />
      <RejectLogoDialog logo={rejecting} onClose={() => setRejecting(null)} onConfirm={(l) => void reject(l)} />
    </>
  );
}
