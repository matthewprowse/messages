"use client";

// Admin, Audit: the last 100 admin actions (budget saves, switch changes, seat changes, approvals) with who, when and the
// old and new values. The database writes it from triggers, so it cannot be skipped. Values are numbers, flags and ids only:
// an email, a name or message text is never stored in it.

import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AUDIT_LABELS, auditChanges } from "@/lib/admin-ops";
import { EmptyState } from "@/components/primitives";
import { AdminHeading, AdminRow } from "@/components/admin/parts";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

type Entry = { id: number; at: string; actor_email: string | null; action: string; target: string | null; old_value: unknown; new_value: unknown };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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

  return (
    <div className="flex flex-col gap-3">
      <AdminHeading title="Audit Log" description="Who changed what in Admin, newest first. Old and new values are shown for the fields that changed." />
      {failed ? (
        <EmptyState icon={ScrollText} title="Could Not Load the Audit Log" description="Check your connection and refresh. If it keeps failing, the flags migration may not be applied." />
      ) : rows === null ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-14 w-full rounded-lg" /><Skeleton className="h-14 w-full rounded-lg" /></div>
      ) : rows.length === 0 ? (
        <div className="py-8"><EmptyState icon={ScrollText} title="Nothing Yet" description="Admin changes will be listed here." /></div>
      ) : (
        <div>
          {rows.map((r, i) => (
            <div key={r.id}>
              {i > 0 && <Separator className="ml-3" />}
              <AdminRow
                title={AUDIT_LABELS[r.action] ?? r.action}
                description={
                  <>
                    <div>{when(r.at)}, {r.actor_email ?? "System"}{r.target ? `, ${r.target.length > 24 ? r.target.slice(0, 8) : r.target}` : ""}</div>
                    {auditChanges(r.old_value, r.new_value).map((c) => <div key={c.key} className="font-mono">{c.key}: {c.from} to {c.to}</div>)}
                  </>
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
