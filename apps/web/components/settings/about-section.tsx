"use client";

// Settings, AI, About: your role and goals, and the people who matter, which the AI reads before it ranks or writes anything.
// Both are stored encrypted (see lib/data/profile-seal.ts).

import { useState } from "react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SettingsSection } from "@/components/settings/primitives";

/** The About form. Remount it when the saved profile arrives, because it copies the profile when it mounts. */
export function AboutSection() {
  const { profile, dispatch, notify } = useApp();
  const [form, setForm] = useState({ about: profile.about, people: profile.people });
  // Save is only offered when the form differs from what is saved.
  const changed = form.about.trim() !== profile.about || form.people.trim() !== profile.people;
  return (
    <SettingsSection id="about" title="About" description="The AI reads this before it ranks anything or writes a word. It is stored encrypted.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!changed) return; dispatch({ type: "patchProfile", patch: { about: form.about.trim(), people: form.people.trim() } }); notify("Saved"); }}>
        <div className="grid gap-2">
          <Label htmlFor="about">Role and Goals</Label>
          <Textarea id="about" rows={5} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} placeholder="Estate agent in Cape Town, selling in the Atlantic Seaboard. I want enquiries answered within the hour." />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="people">Important People</Label>
          <Textarea id="people" rows={4} value={form.people} onChange={(e) => setForm({ ...form, people: e.target.value })} placeholder="Thandi Nkosi, my business partner" />
          <p className="text-xs text-muted-foreground">Who they are to you, so the AI knows a one-line message from your co-founder outranks a long newsletter.</p>
        </div>
        <Button variant="secondary" type="submit" disabled={!changed}>Save</Button>
      </form>
    </SettingsSection>
  );
}
