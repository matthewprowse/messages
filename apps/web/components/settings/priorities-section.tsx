"use client";

// Settings, AI, Priorities: sender rules that win over the AI. Reads ?add= so "Add Priority Rule" in a conversation
// can prefill the sender. Render inside <Suspense>.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { normaliseRuleTarget } from "@/lib/rule-target";
import type { Rule } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsBody, SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

const GROUPS: { kind: Rule["kind"]; title: string }[] = [
  { kind: "always_important", title: "Always Important" },
  { kind: "never_important", title: "Never Important" },
];

/** The rules form and the two lists. A target is tidied to the form senders are matched on before it is saved. */
export function PrioritiesSection() {
  const params = useSearchParams();
  const { rules, dispatch, notify } = useApp();
  const [target, setTarget] = useState(params.get("add") ?? "");
  const [kind, setKind] = useState<Rule["kind"]>("always_important");
  // A second "Add Priority Rule" from another conversation arrives as a new ?add= on this same page.
  const add = params.get("add");
  useEffect(() => { if (add) setTarget(add); }, [add]);
  const addRule = () => {
    const parsed = normaliseRuleTarget(target);
    if (!parsed.ok) return notify(parsed.error);
    if (rules.some((r) => r.target.toLowerCase() === parsed.value)) return notify("That sender already has a rule");
    dispatch({ type: "addRule", rule: { id: `r-${Date.now()}`, kind, target: parsed.value } });
    setTarget("");
    notify("Rule added");
  };
  return (
    <SettingsSection id="priorities" title="Priorities">
      <SettingsBody>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); addRule(); }}>
          <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="name@company.co.za, +27 82 123 4567 or company.co.za" aria-label="Sender Address, Phone Number or Domain" required className="flex-1" />
          <Select value={kind} onValueChange={(v) => setKind(v as Rule["kind"])}>
            <SelectTrigger className="sm:w-44" aria-label="Rule Type"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="always_important">Always Important</SelectItem><SelectItem value="never_important">Never Important</SelectItem></SelectContent>
          </Select>
          <Button variant="secondary" type="submit">Add</Button>
        </form>
      </SettingsBody>
      {GROUPS.map((g) => {
        const list = rules.filter((r) => r.kind === g.kind);
        return (
          <SettingsSection key={g.kind} level={3} title={g.title}>
            {list.length === 0 ? <SettingsEmpty>No rules yet.</SettingsEmpty> : (
              <SettingsRows>
                {list.map((r) => (
                  <SettingsRow key={r.id} title={r.target}>
                    <Button variant="ghost" size="icon" aria-label={`Remove Rule: ${r.target}`} onClick={() => { dispatch({ type: "removeRule", id: r.id }); notify("Rule removed", () => dispatch({ type: "addRule", rule: r })); }}><Trash2 /></Button>
                  </SettingsRow>
                ))}
              </SettingsRows>
            )}
          </SettingsSection>
        );
      })}
    </SettingsSection>
  );
}
