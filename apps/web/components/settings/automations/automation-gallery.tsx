"use client";

// The gallery on Settings, Automations: a row for each template (set up, then switch on or off, change, remove), the user's own
// Custom automations, and the New Custom row. Turning anything on goes through the 30 day preview (turn-on-dialog.tsx).

import { useMemo, useState } from "react";
import { Building2, Home, Wand2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { IconCircle } from "@/components/surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { removeAutomation, setEnabled, type Automation } from "@/lib/automations/io";
import { doSummary, whenSummary } from "@/lib/automations/spec";
import { customSpec, TEMPLATES, type Template } from "@/lib/automations/templates";
import { BuilderDialog } from "./builder-dialog";
import { TurnOnDialog, type TurnOn } from "./turn-on-dialog";

const ICON: Record<string, LucideIcon> = { property24: Home, private_property: Building2 };

export function AutomationGallery({ automations, onChanged }: { automations: Automation[]; onChanged: () => void }) {
  const [turnOn, setTurnOn] = useState<TurnOn | null>(null);
  const [editing, setEditing] = useState<{ automation?: Automation } | null>(null);
  const [removing, setRemoving] = useState<Automation | null>(null);
  const blank = useMemo(customSpec, []);
  const custom = automations.filter((a) => a.templateKey === null);
  const forTemplate = (t: Template) => automations.find((a) => a.templateKey === t.key);

  const toggle = async (a: Automation, on: boolean) => {
    if (on) return setTurnOn({ automation: a, templateKey: a.templateKey, spec: a.spec });
    const problem = await setEnabled(a.id, false);
    if (problem) toast(problem);
    onChanged();
  };
  const remove = async () => {
    if (!removing) return;
    const problem = await removeAutomation(removing.id);
    setRemoving(null);
    toast(problem ?? "Deleted. The contacts, tasks and drafts it made are still there.");
    onChanged();
  };

  const controls = (a: Automation) => (
    <>
      <Button variant="ghost" onClick={() => setEditing({ automation: a })}>Change</Button>
      <Button variant="ghost" onClick={() => setRemoving(a)}>Delete</Button>
      <Switch checked={a.enabled} onCheckedChange={(on) => void toggle(a, on)} aria-label={`${a.spec.name} On`} />
    </>
  );

  return (
    <>
      <SettingsSection id="templates" title="Templates">
        <SettingsRows inset="lead">
          {TEMPLATES.map((t) => {
            const saved = forTemplate(t);
            return (
              <SettingsRow key={t.key} leading={<IconCircle icon={ICON[t.key]} />} title={<>{t.name} {saved?.enabled && <Badge variant="secondary">On</Badge>}</>}>
                {saved ? controls(saved) : <Button variant="secondary" onClick={() => setTurnOn({ templateKey: t.key, spec: t.spec })}>Set Up</Button>}
              </SettingsRow>
            );
          })}
        </SettingsRows>
      </SettingsSection>

      <SettingsSection id="custom" title="Custom">
        <SettingsRows inset="lead">
          {custom.map((a) => (
            <SettingsRow key={a.id} leading={<IconCircle icon={Wand2} />} title={<>{a.spec.name} {a.enabled && <Badge variant="secondary">On</Badge>}</>} description={<><span className="block truncate">{whenSummary(a.spec)}</span><span className="block truncate">{doSummary(a.spec).join(", ")}</span></>}>
              {controls(a)}
            </SettingsRow>
          ))}
          <SettingsRow leading={<IconCircle icon={Wand2} />} title="New Custom Automation">
            <Button variant="secondary" onClick={() => setEditing({})}>Create</Button>
          </SettingsRow>
        </SettingsRows>
      </SettingsSection>

      <TurnOnDialog target={turnOn} onClose={() => setTurnOn(null)} onDone={onChanged} />
      <BuilderDialog open={editing !== null} automation={editing?.automation} initial={blank} onClose={() => setEditing(null)} onSaved={onChanged} />
      <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {removing?.spec.name}?</AlertDialogTitle>
            <AlertDialogDescription>It stops running and its run history is deleted. The contacts, tasks and drafts it already made stay where they are.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
