"use client";

// Admin's Audit view: the last 100 admin actions (budget saves, switch changes, seat changes, approvals) with who, when and
// the old and new values of the fields that changed. The database writes it from triggers, so it cannot be skipped. Values
// are numbers, flags and ids only: an email, a name or message text is never stored in it.

import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AUDIT_LABELS, auditChanges } from "@/lib/admin-ops";
import { Card, IconCircle, Row, Separated } from "@/components/surface";
import { when } from "./format";
import { Failed, LoadingCard, Quiet } from "./parts";

type Entry = { id: number; at: string; actor_email: string | null; action: string; target: string | null; old_value: unknown; new_value: unknown };

export function AuditLog({ version, onBusy }: { version: number; onBusy: (busy: boolean) => void }) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    onBusy(true);
    const { data, error } = await supabase.rpc("admin_audit_log", { p_limit: 100 });
    onBusy(false);
    if (error) return setFailed(true);
    setFailed(false);
    setRows((data ?? []) as Entry[]);
  }, [onBusy]);
  useEffect(() => { void load(); }, [load, version]);

  if (failed) return <Failed title="Could Not Load The Audit Log" onRetry={() => void load()} />;
  if (rows === null) return <LoadingCard title="Audit Log" rows={3} />;
  return (
    <Card title="Audit Log">
      {rows.length === 0 ? <Quiet>Nothing changed in Admin yet. Saving the AI budget, a flag or the daily alert, deciding a request and changing seats are recorded here.</Quiet> : (
        <Separated>
          {rows.map((r) => {
            const changes = auditChanges(r.old_value, r.new_value);
            return (
              <div key={r.id}>
                <Row
                  lead={<IconCircle icon={ScrollText} />}
                  title={AUDIT_LABELS[r.action] ?? r.action}
                  meta={when(r.at)}
                  detail={`${r.actor_email ?? "System"}${r.target ? `, ${r.target.length > 24 ? r.target.slice(0, 8) : r.target}` : ""}`}
                />
                {changes.length > 0 && (
                  <div className="-mt-2 flex flex-col gap-1 pr-3 pb-3 pl-16 font-mono text-xs text-muted-foreground">
                    {changes.map((c) => <span key={c.key} className="break-all">{c.key}: {c.from} to {c.to}</span>)}
                  </div>
                )}
              </div>
            );
          })}
        </Separated>
      )}
    </Card>
  );
}
