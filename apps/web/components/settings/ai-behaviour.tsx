"use client";

// Settings, AI, Behaviour: whether drafts are made for you, the tone they default to and which language the AI writes summaries in.

import { useApp } from "@/lib/store";
import { DRAFT_TONES, toDraftTone } from "@/lib/draft-tone";
import { useDraftTone } from "@/lib/use-draft-tone";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

const LANGUAGES = [
  { value: "auto", label: "Follow How I Write" },
  { value: "en-GB", label: "British English" },
  { value: "en-US", label: "American English" },
  { value: "af", label: "Afrikaans" },
] as const;

/** Auto Draft Replies, Draft Tone and the summary language. Both save through patchProfile, which rolls back if the save fails. */
export function AiBehaviourSection() {
  const { profile, dispatch, notify } = useApp();
  const draftTone = useDraftTone();
  return (
    <SettingsSection id="ai-behaviour" title="Behaviour">
      <SettingsRows>
        <SettingsRow title="Auto Draft Replies">
          <Switch checked={profile.autoDraftTop} onCheckedChange={(v) => dispatch({ type: "patchProfile", patch: { autoDraftTop: v } })} aria-label="Auto Draft Replies" />
        </SettingsRow>
        <SettingsRow title="Draft Tone">
          <Select value={draftTone.tone ?? "usual"} disabled={draftTone.tone === undefined} onValueChange={async (v) => { if (!(await draftTone.save(v === "usual" ? null : toDraftTone(v)))) notify("Could not save. Try again."); }}>
            <SelectTrigger className="w-48" aria-label="Draft Tone"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="usual">Match How I Write</SelectItem>
              {DRAFT_TONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Language">
          <Select value={profile.language ?? "auto"} onValueChange={(v) => dispatch({ type: "patchProfile", patch: { language: v === "auto" ? null : (v as "en-GB" | "en-US" | "af") } })}>
            <SelectTrigger className="w-48" aria-label="Language"><SelectValue /></SelectTrigger>
            <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}
