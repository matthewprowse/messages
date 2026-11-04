"use client";

// Settings, Drafts: a live overview of everything the AI reads to write a draft, then what it has learned (style rules, how
// you write to people, companies) as cards of their own, so it is clear what it knows.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import type { Tables } from "@messages/db";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { fullStamp } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { IconAction } from "@/components/tip";
import { openAddresses, openOrganizations, openRules } from "@/lib/open-rows";
import { ruleNote } from "@/lib/rule-note";

type StyleRule = Pick<Tables<"style_rules">, "id" | "rule" | "scope" | "contact_id" | "source" | "support_count" | "enabled" | "disabled_reason">;
type PersonNote = Pick<Tables<"contacts">, "id" | "display_name" | "style_note" | "ai_summary" | "style_updated_at">;
type OrgNote = Pick<Tables<"organizations">, "id" | "name" | "domain" | "summary" | "summary_updated_at">;
type Learning = { learnedAt: string | null; notes: PersonNote[]; orgs: OrgNote[]; indexed: number; kept: number | null; outcomes: number };

const SAVE_FAILED = "Could not save that change. Check your connection and try again.";
const SHOWN = 6;
const UNDO_MS = 5_000;

const GROUPS: { source: string; title: string }[] = [
  { source: "sent_mail", title: "From Your Sent Mail" },
  { source: "edits", title: "From Your Edits" },
  { source: "signals", title: "From Your Choices" },
  { source: "manual", title: "Added By You" },
];

function Source({ title, detail, value, href }: { title: string; detail?: string; value: string; href?: string }) {
  return (
    <SettingsRow title={title} description={detail}>
      <Badge variant="secondary">{value}</Badge>
      {href && <Button variant="ghost" asChild><Link href={href}>Edit</Link></Button>}
    </SettingsRow>
  );
}

// A short list that shows the first few and can expand, for people and companies.
function Expandable<T>({ items, render }: { items: T[]; render: (item: T) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <SettingsRows>{(all ? items : items.slice(0, SHOWN)).map(render)}</SettingsRows>
      {items.length > SHOWN && (
        <div className="p-1"><Button variant="ghost" onClick={() => setAll((v) => !v)}>{all ? "Show Fewer" : `Show All ${items.length}`}</Button></div>
      )}
    </>
  );
}

// An overview of every input a draft is written from, with live counts, so it is clear what the AI knows.
export function DraftsUseSection() {
  const { profile, writingExamples, accounts, contactById, notify, loading } = useApp();
  const [rules, setRules] = useState<StyleRule[] | null>(null);
  const [rulesFailed, setRulesFailed] = useState(false);
  const [rulesTry, setRulesTry] = useState(0);
  const [sentCount, setSentCount] = useState<number | null>(null);
  const [learning, setLearning] = useState<Learning | null>(null);
  const emailAccountIds = accounts.filter((a) => a.provider === "icloud" || a.provider === "gmail" || a.provider === "outlook" || a.provider === "imap").map((a) => a.id).join(",");

  useEffect(() => {
    if (loading) return; // wait for the session, or row-level security returns nothing
    let cancelled = false;
    setRulesFailed(false);
    supabase.from("style_rules").select("id, rule, scope, contact_id, source, support_count, enabled, disabled_reason").order("support_count", { ascending: false }).limit(200)
      .then(async ({ data, error }) => {
        if (error) { if (!cancelled) { setRulesFailed(true); setRules([]); } return; }
        const opened = await openRules(data);
        if (!cancelled) setRules(opened);
      }, () => { if (!cancelled) { setRulesFailed(true); setRules([]); } });
    return () => { cancelled = true; };
  }, [loading, rulesTry]);

  useEffect(() => {
    if (loading) return;
    const ids = emailAccountIds ? emailAccountIds.split(",") : [];
    if (ids.length === 0) { setSentCount(0); return; }
    let cancelled = false;
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("direction", "outbound").in("account_id", ids)
      .then(({ count }) => { if (!cancelled) setSentCount(count ?? 0); });
    return () => { cancelled = true; };
  }, [loading, emailAccountIds]);

  // What the AI has learned beyond rules: notes per person and company, the search index and how close drafts come.
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    Promise.all([
      supabase.from("profiles").select("voice_learned_at").maybeSingle(),
      supabase.from("contacts").select("id, display_name, style_note, ai_summary, style_updated_at").not("style_note", "is", null).order("style_updated_at", { ascending: false }).limit(100),
      // Company names are sealed, so they are sorted here once opened.
      supabase.from("organizations").select("id, name, domain, summary, summary_updated_at").not("summary", "is", null).order("summary_updated_at", { ascending: false }).limit(500),
      supabase.rpc("embedded_message_count"),
      supabase.from("draft_outcomes").select("edit_ratio").order("created_at", { ascending: false }).limit(50),
    ]).then(async ([p, people, orgs, indexed, outcomes]) => {
      await Promise.all([openAddresses(orgs.data ?? []).then(openOrganizations), openAddresses(people.data ?? [])]);
      orgs.data?.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      if (cancelled) return;
      const ratios = (outcomes.data ?? []).map((o) => o.edit_ratio).filter((r): r is number => r !== null);
      setLearning({
        learnedAt: p.data?.voice_learned_at ?? null,
        notes: people.data ?? [],
        orgs: orgs.data ?? [],
        indexed: Number(indexed.data ?? 0),
        kept: ratios.length ? Math.round((1 - ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) : null,
        outcomes: ratios.length,
      });
    }).catch(() => {
      // Opening the company addresses can fail; show empty lists rather than Loading for ever.
      if (!cancelled) setLearning({ learnedAt: null, notes: [], orgs: [], indexed: 0, kept: null, outcomes: 0 });
    });
    return () => { cancelled = true; };
  }, [loading]);

  const setEnabled = (rule: StyleRule, enabled: boolean) => {
    setRules((list) => list?.map((r) => (r.id === rule.id ? { ...r, enabled, disabled_reason: enabled ? null : "user" } : r)) ?? null);
    supabase.from("style_rules").update({ enabled }).eq("id", rule.id).then(({ error }) => {
      if (!error) return;
      setRules((list) => list?.map((r) => (r.id === rule.id ? rule : r)) ?? null);
      notify(SAVE_FAILED);
    });
  };

  // A removed rule leaves the list at once but is only deleted once the Undo toast has gone, so Undo is a real undo.
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; rule: StyleRule }>());
  const deleteRule = useCallback((rule: StyleRule) => {
    pending.current.delete(rule.id);
    supabase.from("style_rules").delete().eq("id", rule.id).then(({ error }) => {
      if (error) { setRules((list) => (list && !list.some((r) => r.id === rule.id) ? [rule, ...list] : list)); notify(SAVE_FAILED); }
    });
  }, [notify]);
  // Leaving the page finishes any delete still waiting.
  const finish = useRef(deleteRule);
  useEffect(() => { finish.current = deleteRule; }, [deleteRule]);
  useEffect(() => {
    const waiting = pending.current;
    return () => {
      for (const { timer, rule } of [...waiting.values()]) { clearTimeout(timer); finish.current(rule); }
      waiting.clear();
    };
  }, []);

  const remove = (rule: StyleRule) => {
    setRules((list) => list?.filter((r) => r.id !== rule.id) ?? null);
    pending.current.set(rule.id, { timer: setTimeout(() => deleteRule(rule), UNDO_MS), rule });
    notify("Rule removed", () => {
      const waiting = pending.current.get(rule.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.current.delete(rule.id);
      setRules((list) => (list ? [...list, rule].sort((a, b) => b.support_count - a.support_count) : list));
    });
  };

  const on = rules?.filter((r) => r.enabled).length ?? 0;
  const profileParts = [profile.name ? "Name" : "", profile.about ? "About You" : ""].filter(Boolean);
  const learnedLine = learning?.learnedAt ? `Last learned ${fullStamp(learning.learnedAt)}` : undefined;

  return (
    <>
      <SettingsSection id="drafts-use" title="What Drafts Use">
        <SettingsRows>
          <Source title="Your Profile" value={loading ? "Loading" : profileParts.length ? profileParts.join(" and ") : "Not Set"} href="/settings/ai#about" />
          <Source title="Learned Style Rules" detail={learnedLine} value={rules === null ? "Loading" : rulesFailed ? "Unavailable" : `${on} On${rules.length > on ? `, ${rules.length - on} Off` : ""}`} />
          <Source title="People You Write To" value={learning === null ? "Loading" : String(learning.notes.length)} />
          <Source title="Companies" value={learning === null ? "Loading" : String(learning.orgs.length)} />
          <Source title="Similar Past Replies" value={learning === null ? "Loading" : `${learning.indexed} Indexed`} />
          <Source title="Writing Examples" value={loading ? "Loading" : String(writingExamples.length)} href="/settings/ai#writing-style" />
          <Source title="Your Recent Sent Emails" value={sentCount === null ? "Loading" : `${sentCount} Sent`} />
          <Source title="How Close Drafts Are" detail={learning?.outcomes ? `Over your last ${learning.outcomes} drafts` : undefined} value={learning === null ? "Loading" : learning.kept === null ? "Not Yet" : `${learning.kept}% Kept`} />
        </SettingsRows>
      </SettingsSection>

      <SettingsSection id="style-rules" title="Learned Style Rules">
        {rules === null ? null : rulesFailed ? (
          <SettingsRows>
            <SettingsRow title="Could Not Load Your Style Rules">
              <Button variant="secondary" onClick={() => { setRules(null); setRulesTry((n) => n + 1); }}>Retry</Button>
            </SettingsRow>
          </SettingsRows>
        ) : rules.length === 0 ? (
          <SettingsEmpty>Nothing learned yet.</SettingsEmpty>
        ) : (
          GROUPS.map((g) => {
            const list = rules.filter((r) => r.source === g.source);
            if (list.length === 0 && (g.source === "manual" || g.source === "signals")) return null;
            return (
              <SettingsSection key={g.source} level={3} title={g.title}>
                {list.length === 0 ? <SettingsEmpty>None yet.</SettingsEmpty> : (
                  <SettingsRows>
                    {list.map((r) => {
                      const who = r.scope === "contact" && r.contact_id ? contactById(r.contact_id)?.name ?? "One Contact" : "";
                      return (
                        <SettingsRow
                          key={r.id}
                          title={r.rule}
                          description={ruleNote({ who, supportCount: r.support_count, enabled: r.enabled, disabledReason: r.disabled_reason })}
                        >
                          <Switch checked={r.enabled} onCheckedChange={(v) => setEnabled(r, v)} aria-label={r.rule} />
                          <IconAction label={`Remove Rule: ${r.rule}`} icon={Trash2} onClick={() => remove(r)} />
                        </SettingsRow>
                      );
                    })}
                  </SettingsRows>
                )}
              </SettingsSection>
            );
          })
        )}
      </SettingsSection>

      <SettingsSection id="people-notes" title="How You Write to People">
        {learning === null ? null : learning.notes.length === 0 ? (
          <SettingsEmpty>Nothing yet.</SettingsEmpty>
        ) : (
          <Expandable
            items={learning.notes}
            render={(c) => (
              <SettingsRow
                key={c.id}
                href={`/contacts/${c.id}`}
                title={c.display_name}
                description={<>{c.style_note}{c.ai_summary && <span className="block">{c.ai_summary}</span>}</>}
              >
                {c.style_updated_at && <span className="text-xs text-muted-foreground">{fullStamp(c.style_updated_at)}</span>}
              </SettingsRow>
            )}
          />
        )}
      </SettingsSection>

      <SettingsSection id="companies" title="Companies">
        {learning === null ? null : learning.orgs.length === 0 ? (
          <SettingsEmpty>Nothing yet.</SettingsEmpty>
        ) : (
          <Expandable
            items={learning.orgs}
            render={(o) => (
              <SettingsRow key={o.id} title={o.name} description={o.summary}>
                <span className="text-xs text-muted-foreground">{o.domain}</span>
              </SettingsRow>
            )}
          />
        )}
      </SettingsSection>
    </>
  );
}
