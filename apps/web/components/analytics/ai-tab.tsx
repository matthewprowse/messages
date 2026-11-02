"use client";

// The AI tab of the Analytics page: labelling accuracy, drafts, replies and cost, from the AiReport that derive-ai.ts builds.
// Tables that are for tuning prompts (edit details, per tone and channel, per prompt) sit under Advanced.
// Presentational only; it does no arithmetic beyond formatting.

import { useState } from "react";
import { DIMENSIONS, type Dimension, type LabelFieldName } from "@messages/analytics/stats";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AiReport } from "./derive-ai";
import { Advanced, Bars, CountTile, EmptyState, SMALL_SAMPLE, Section, SECTIONS, Share, Table, Tile, Tiles, compact, money, ms, nice, num, of, percent, seconds, shortDay, share } from "./parts";

const DIMENSION_LABEL: Record<Dimension, string> = {
  sender: "Kind Of Sender",
  channel: "Channel",
  bulk: "Has Unsubscribe Header",
  attach: "Has Attachment",
  len: "Length",
  hour: "Time Of Day",
  known: "Sender Known",
  source: "What Decided It",
  prompt: "Prompt Version",
};
const FIELD_LABEL: Record<LabelFieldName, string> = { junk: "Junk", priority: "Priority" };

function Splits({ report }: { report: AiReport }) {
  const [field, setField] = useState<LabelFieldName>("junk");
  const [dim, setDim] = useState<Dimension>("sender");
  const rows = report.splits[field][dim];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={field} onValueChange={(v) => setField(v as LabelFieldName)}>
          <SelectTrigger size="sm" className="w-40" aria-label="Label"><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(FIELD_LABEL) as LabelFieldName[]).map((f) => <SelectItem key={f} value={f}>{FIELD_LABEL[f]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={dim} onValueChange={(v) => setDim(v as Dimension)}>
          <SelectTrigger size="sm" className="w-56" aria-label="Split by"><SelectValue /></SelectTrigger>
          <SelectContent>{DIMENSIONS.map((d) => <SelectItem key={d} value={d}>{DIMENSION_LABEL[d]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Table
        empty="No labels recorded yet."
        rows={rows}
        cols={[
          { head: DIMENSION_LABEL[dim], cell: (s) => nice(s.value) },
          { head: "Labelled", cell: (s) => num(s.triaged), num: true },
          { head: "Corrected", cell: (s) => num(s.corrected), num: true },
          { head: "Corrected Share (Approximate)", cell: (s) => <Share part={s.corrected} whole={s.triaged} />, num: true },
          { head: "Sample", cell: (s) => (s.triaged < SMALL_SAMPLE ? "Small" : "Fair"), num: true },
        ]}
      />
    </div>
  );
}

export function AiTab({ report: r, empty }: { report: AiReport; empty: boolean }) {
  if (empty) return <EmptyState title="Nothing Captured Yet">Events appear here as mail is sorted and drafts are written.</EmptyState>;
  const d = r.drafts;
  const k = r.cost;
  return (
    <div className={SECTIONS}>
      <Section title="Fix First" description="What the AI said, against what people changed it to. The most common pairs are where to start.">
        <Tiles>
          <Tile label="Labels Made" value={num(r.triaged.value)} stat={r.triaged} />
          <Tile label="Corrections" value={num(r.corrections.value)} stat={r.corrections} />
          <CountTile label="Junk Wrongly Called" part={r.junk.notJunk} whole={r.junk.shown} note="of those called Junk" />
          <CountTile label="Junk Missed" part={r.junk.missed} whole={r.junk.notShown} note="of those not called Junk" />
        </Tiles>
        <Table
          empty="No corrections yet."
          rows={r.pairs}
          cols={[
            { head: "Label", cell: (p) => nice(p.field) },
            { head: "The AI Said", cell: (p) => nice(p.from) },
            { head: "Changed To", cell: (p) => nice(p.to) },
            { head: "Times", cell: (p) => num(p.n), num: true },
          ]}
        />
      </Section>

      <Section title="Where It Goes Wrong" description="The share of labels people corrected, split by a fact about the message, never its words. Approximate: corrections made in the period are set against labels made in the period, and only Junk and Priority can be corrected by hand. A small sample is a hint, not an answer.">
        <Splits report={r} />
      </Section>

      <Section title="Drafts" description="From the draft shown to the reply sent.">
        <Tiles>
          <CountTile label="Sent As Written" part={d.asWritten.part} whole={d.asWritten.whole} note="of drafts sent" />
          <CountTile label="Edited First" part={d.edited.part} whole={d.edited.whole} note={d.avgChangedPct ? `${num(d.avgChangedPct)}% of words changed, on average` : undefined} />
          <CountTile label="Thrown Away" part={d.discarded} whole={d.sent + d.discarded} note="of drafts sent or discarded" />
          <Tile label="Time To Send" value={seconds(d.medianSecsToSend)} note="Median, from draft shown" />
          <Tile label="Asked For" value={num(d.requested)} note={`${num(d.shown)} shown, ${num(d.failed)} failed`} />
          <Tile label="Written In" value={ms(d.medianMsToShow)} note="Median" />
          <Tile label="Asked Again" value={num(d.avgRegenerated)} note="Extra drafts per reply, on average" />
          <CountTile label="Choices Tapped" part={r.choices.tapped} whole={r.choices.shown} note="of choices shown" />
        </Tiles>
      </Section>

      <Section title="Replies And Summaries">
        <Tiles>
          <Tile label="Replies Sent" value={num(r.replies.total)} />
          <CountTile label="To Needs Reply" part={r.replies.toNeedsReply.part} whole={r.replies.toNeedsReply.whole} note="of replies the AI had flagged" />
          <CountTile label="Summary Was Enough" part={r.summaries.enough.part} whole={r.summaries.enough.whole} note={`${num(r.summaries.originalAfter)} opened the original after`} />
          <Tile label="Briefs Played" value={num(r.brief.plays)} />
        </Tiles>
        <Table
          empty="No replies yet."
          rows={r.replies.byPriority}
          cols={[{ head: "Replied To", cell: (p) => nice(p.priority) }, { head: "Replies", cell: (p) => num(p.n), num: true }]}
        />
      </Section>

      <Section title="Cost And Speed" description="From every model call the AI makes. Prompt versions change when the instructions do.">
        <Tiles>
          <Tile label="Calls" value={num(k.calls)} note="Model calls made" />
          <CountTile label="Failed" part={k.failed} whole={k.calls} note="of calls" />
          <Tile label="Cached" value={of(k.cachedTok, k.inTok, compact)} note={k.inTok === 0 ? undefined : `${percent(Math.round(share(k.cachedTok, k.inTok) * 10) / 10)} of input tokens`} />
          <Tile label="Spend" value={money(k.usd.value)} stat={k.usd} fmt={money} />
        </Tiles>
        <Tiles>
          <Tile label="Per Person A Month" value={money(k.perUserMonth.avgUsd)} note={`Average over ${num(k.perUserMonth.users)} people who cost anything, scaled to 30 days`} />
          <Tile label="Dearest 10% Of People" value={money(k.perUserMonth.p90Usd)} note="90th percentile, per month" />
        </Tiles>
        {k.perUserMonth.top.length > 0 && (
          <Table
            rows={k.perUserMonth.top}
            cols={[{ head: "Dearest Five People", cell: (t) => <span className="font-mono text-xs">{t.user}</span> }, { head: "A Month", cell: (t) => money(t.usd), num: true }]}
          />
        )}
        <Bars label="Spend Each Day" format={money} data={k.series.map((x) => ({ label: shortDay(x.day), value: x.usd }))} />
        <Table
          empty="No model calls yet."
          rows={k.byFeature}
          cols={[
            { head: "Feature", cell: (f) => nice(f.feature) },
            { head: "Calls", cell: (f) => num(f.calls), num: true },
            { head: "Failed", cell: (f) => <Share part={f.failed} whole={f.calls} />, num: true },
            { head: "Retries", cell: (f) => num(f.retries), num: true, wide: true },
            { head: "Typical", cell: (f) => ms(f.p50), num: true, wide: true },
            { head: "Slow (95th Percentile)", cell: (f) => ms(f.p95), num: true },
            { head: "Cached", cell: (f) => <Share part={f.cachedTok} whole={f.inTok} fmt={compact} />, num: true },
            { head: "Spend", cell: (f) => money(f.usd), num: true },
          ]}
        />
      </Section>
      <Advanced title="Advanced: Prompt Tuning">
        <Tiles>
          <CountTile label="Pre-Drafts Sent" part={d.pre.sent} whole={d.pre.written} note={`${num(d.pre.asWritten.part)} as written, ${num(d.pre.discarded)} thrown away`} />
          <CountTile label="Briefs Played To The End" part={r.brief.completed.part} whole={r.brief.completed.whole} />
          <Tile label="Brief Stopped At" value={seconds(r.brief.medianStopSecs)} note="Median, of those who stopped" />
          <CountTile label="Transcripts Failed" part={r.voice.transcriptsFailed.part} whole={r.voice.transcriptsFailed.whole} note={`${num(r.voice.afterTranscript)} of ${num(r.voice.played)} plays followed reading it`} />
        </Tiles>
        <Table
          empty="No edited drafts yet."
          rows={[
            { what: "Greeting Changed", p: d.greeting },
            { what: "Sign-Off Changed", p: d.signoff },
            { what: "A Question Added", p: d.questionAdded },
            { what: "A Question Removed", p: d.questionRemoved },
            { what: "Emoji Added", p: d.emoji },
          ]}
          cols={[{ head: "Of Edited Drafts", cell: (x) => x.what }, { head: "Share", cell: (x) => <Share part={x.p.part} whole={x.p.whole} />, num: true }]}
        />
        {d.toneMoved.length > 0 && (
          <Table rows={d.toneMoved} cols={[{ head: "Tone Moved Towards", cell: (t) => nice(t.key) }, { head: "Drafts", cell: (t) => num(t.n), num: true }]} />
        )}
        <Table
          empty="No drafts sent."
          rows={d.byTone}
          cols={[{ head: "Tone", cell: (t) => nice(t.tone) }, { head: "Sent", cell: (t) => num(t.sent), num: true }, { head: "Sent As Written", cell: (t) => <Share part={t.asWritten.part} whole={t.asWritten.whole} />, num: true }]}
        />
        <Table
          empty="No drafts sent."
          rows={d.byChannel}
          cols={[{ head: "Channel", cell: (t) => nice(t.channel) }, { head: "Sent", cell: (t) => num(t.sent), num: true }, { head: "Sent As Written", cell: (t) => <Share part={t.asWritten.part} whole={t.asWritten.whole} />, num: true }]}
        />
        {r.choices.byKind.length > 0 && (
          <Table rows={r.choices.byKind} cols={[{ head: "Choice Tapped", cell: (t) => nice(t.key) }, { head: "Times", cell: (t) => num(t.n), num: true }]} />
        )}
        <Table
          empty="No model calls yet."
          rows={k.byPrompt}
          max={12}
          cols={[
            { head: "Feature", cell: (p) => nice(p.feature) },
            { head: "Model", cell: (p) => p.model },
            { head: "Prompt", cell: (p) => (p.prompt === "before_tracking" ? "Before Tracking" : <span className="font-mono text-xs">{p.prompt}</span>) },
            { head: "Calls", cell: (p) => num(p.calls), num: true },
            { head: "Failed", cell: (p) => <Share part={p.failed} whole={p.calls} />, num: true },
            { head: "Typical", cell: (p) => ms(p.p50), num: true, wide: true },
            { head: "Spend", cell: (p) => money(p.usd), num: true },
          ]}
        />
      </Advanced>
    </div>
  );
}
