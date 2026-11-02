"use client";

// Admin, Flags: the kill switches. A switch that is on is thrown: the thing it names is paused or disabled, for everyone or
// only for the people listed. The workers and the web app read the table with a cache of a few seconds, so a change bites
// almost at once and needs no deploy. Every change is written to the audit log by the database. Rules: lib/feature-flags.ts.

import { useCallback, useEffect, useState } from "react";
import { ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { flagChanged, flagLabel, orderFlags, parseEmails, resetFlagState, type AdminFlag } from "@/lib/feature-flags";
import { EmptyState } from "@/components/primitives";
import { AdminHeading } from "@/components/admin/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

function FlagRow({ flag, onSaved }: { flag: AdminFlag; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(flag.enabled);
  const [people, setPeople] = useState(flag.emails.join("\n"));
  const [busy, setBusy] = useState(false);
  const parsed = parseEmails(people);
  const changed = parsed.ok && flagChanged(flag, enabled, parsed.emails);
  const save = async () => {
    if (!parsed.ok) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_set_flag", { p_key: flag.key, p_enabled: enabled, p_emails: parsed.emails });
    setBusy(false);
    if (error) return void toast.error(error.code === "22023" ? "One of those emails does not belong to anyone." : "Could not save the switch.");
    resetFlagState();
    toast.success(`${flagLabel(flag.key)} saved.`);
    onSaved();
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg p-3 hover:bg-muted/50">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{flagLabel(flag.key)}{flag.enabled && <Badge variant="destructive">On</Badge>}{flag.emails.length > 0 && <Badge variant="outline">{flag.emails.length} {flag.emails.length === 1 ? "Person" : "People"} Only</Badge>}</div>
          <div className="text-xs text-muted-foreground">{flag.description}</div>
        </div>
        <Switch aria-label={flagLabel(flag.key)} checked={enabled} onCheckedChange={setEnabled} />
        <Button size="sm" disabled={!changed || busy} onClick={() => void save()}>Save</Button>
      </div>
      <Textarea aria-label={`People for ${flagLabel(flag.key)}`} aria-invalid={!parsed.ok || undefined} rows={flag.emails.length > 1 ? Math.min(5, flag.emails.length) : 1} placeholder="Everyone. Or list emails, one per line, to limit it to them." value={people} onChange={(e) => setPeople(e.target.value)} className="min-h-9 text-sm" />
      {!parsed.ok && <p role="alert" className="text-xs text-destructive">That is not an email address.</p>}
    </div>
  );
}

export function FlagsPanel({ version, onBusy }: { version: number; onBusy: (busy: boolean) => void }) {
  const [rows, setRows] = useState<AdminFlag[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    onBusy(true);
    const { data, error } = await supabase.rpc("admin_feature_flags");
    onBusy(false);
    if (error) return setFailed(true);
    setFailed(false);
    setRows(orderFlags(data ?? []));
  }, [onBusy]);
  useEffect(() => { void load(); }, [load, version]);

  return (
    <div className="flex flex-col gap-3">
      <AdminHeading title="Kill Switches" description="A switch that is on stops the thing it names, for everyone or only the people listed. It bites within seconds, and each change is recorded in the Audit tab." />
      {failed ? (
        <EmptyState icon={ToggleRight} title="Could Not Load Switches" description="Check your connection and refresh. If it keeps failing, the flags migration may not be applied." />
      ) : rows === null ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-20 w-full rounded-lg" /><Skeleton className="h-20 w-full rounded-lg" /></div>
      ) : (
        <div>
          {rows.map((f, i) => (
            <div key={`${f.key}-${f.updated_at}`}>
              {i > 0 && <Separator className="ml-3" />}
              <FlagRow flag={f} onSaved={() => void load()} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
