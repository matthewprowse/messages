"use client";

// Settings, AI, Behaviour: when drafts are made for you and which language the AI writes summaries in.

import { useApp } from "@/lib/store";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

const LANGUAGES = [
  { value: "auto", label: "Follow How I Write" },
  { value: "en-GB", label: "British English" },
  { value: "en-US", label: "American English" },
  { value: "af", label: "Afrikaans" },
] as const;

/** Auto-Draft Replies and the summary language. Both save through patchProfile, which rolls back if the save fails. */
export function AiBehaviourSection() {
  const { profile, dispatch } = useApp();
  return (
    <SettingsSection id="ai-behaviour" title="Behaviour">
      <SettingsRows>
        <SettingsRow title="Auto-Draft Replies" description="A reply is ready when you open a conversation that needs one. You still send it.">
          <Switch checked={profile.autoDraftTop} onCheckedChange={(v) => dispatch({ type: "patchProfile", patch: { autoDraftTop: v } })} aria-label="Auto-Draft Replies" />
        </SettingsRow>
        <SettingsRow title="Language" description="The language and spelling the AI writes summaries and briefs in. Following how you write, it matches your own messages in each conversation, so it can differ between people.">
          <Select value={profile.language ?? "auto"} onValueChange={(v) => dispatch({ type: "patchProfile", patch: { language: v === "auto" ? null : (v as "en-GB" | "en-US" | "af") } })}>
            <SelectTrigger className="w-48" aria-label="Language"><SelectValue /></SelectTrigger>
            <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}
