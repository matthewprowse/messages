"use client";

// Admin's Flags view: the kill switches. A switch that is on is thrown: the thing it names is paused or disabled, for
// everyone or only the people listed. The workers and the web app read the table with a cache of a few seconds, so a change
// bites almost at once and needs no deploy. Every change is written to the audit log by the database. Rules: lib/feature-flags.ts.

import { useCallback, useEffect, useState } from "react";
import { ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { flagChanged, flagLabel, orderFlags, parseEmails, resetFlagState, type AdminFlag } from "@/lib/feature-flags";
import { Card, IconCircle, Row, Separated } from "@/components/surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Failed, LoadingCard } from "./parts";

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
    if (error) return void toast.error(error.code === "22023" ? "One of those emails does not belong to anyone." : "Could Not Save The Switch");
    resetFlagState();
    toast.success(`${flagLabel(flag.key)} Saved`);
    onSaved();
  };
  return (
    <div>
      <Row
        lead={<IconCircle icon={ToggleRight} className={flag.enabled ? "text-destructive" : undefined} />}
        title={<>{flagLabel(flag.key)}{flag.enabled && <Badge variant="destructive" className="ml-2">On</Badge>}{flag.emails.length > 0 && <Badge variant="outline" className="ml-2">{flag.emails.length} {flag.emails.length === 1 ? "Person" : "People"}</Badge>}</>}
        detail={flag.description}
        end={
          <>
            <Switch aria-label={flagLabel(flag.key)} checked={enabled} onCheckedChange={setEnabled} />
            <Button variant="secondary" className="ml-2" disabled={!changed || busy} onClick={() => void save()}>Save</Button>
          </>
        }
      />
      <div className="-mt-1 flex flex-col gap-1 pr-3 pb-3 pl-16">
        <Textarea aria-label={`People for ${flagLabel(flag.key)}`} aria-invalid={!parsed.ok || undefined} rows={flag.emails.length > 1 ? Math.min(5, flag.emails.length) : 1} placeholder="Everyone, Or One Email Per Line" value={people} onChange={(e) => setPeople(e.target.value)} className="min-h-8 text-sm" />
        {!parsed.ok && <p role="alert" className="text-xs text-destructive">That is not an email address.</p>}
      </div>
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

  if (failed) return <Failed title="Could Not Load Switches" onRetry={() => void load()} />;
  if (rows === null) return <LoadingCard title="Kill Switches" rows={3} />;
  return (
    <Card title="Kill Switches">
      <Separated>
        {rows.map((f) => <FlagRow key={`${f.key}-${f.updated_at}`} flag={f} onSaved={() => void load()} />)}
      </Separated>
    </Card>
  );
}
