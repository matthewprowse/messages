"use client";

// The Settings page sections (About, Writing, Priorities, Appearance, Language, Data, Getting Started, Sign In) and the heading and row components every Settings page uses.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { signOut, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PHOTO_BUCKET, photoPathFor, squareJpeg } from "@/lib/profile-photo";
import { MyAvatar } from "@/components/my-avatar";
import { saveOnboarding } from "@/lib/onboarding";
import type { Rule } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// The one heading style in Settings, for sections and the groups inside them alike.
export function SettingsHeading({ title, description, level = 2 }: { title: React.ReactNode; description?: React.ReactNode; level?: 2 | 3 | 4 }) {
  const Tag = `h${level}` as const;
  return (
    <div>
      <Tag className="flex min-h-8 items-center text-sm font-medium">{title}</Tag>
      {description && <div className="text-sm text-muted-foreground">{description}</div>}
    </div>
  );
}

export function SettingsSection({ id, title, description, level, children }: { id?: string; title: React.ReactNode; description?: React.ReactNode; level?: 2 | 3 | 4; children: React.ReactNode }) {
  return (
    <section id={id} className={cn("scroll-mt-16 space-y-3", (level ?? 2) === 2 && "[&:not(:first-child)]:border-t [&:not(:first-child)]:pt-3")}>
      <SettingsHeading title={title} description={description} level={level} />
      {children}
    </section>
  );
}

// The one row style in Settings: Inbox-style rows, each a title and description with any controls on the right.
export function SettingsRows({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

export function SettingsRow({ title, description, leading, href, children }: { title: React.ReactNode; description?: React.ReactNode; leading?: React.ReactNode; href?: string; children?: React.ReactNode }) {
  // The controls wrap under the text when the row is narrow, so a long title is never squashed beside them.
  const body = (
    <>
      <div className="flex min-w-[12rem] flex-1 items-center gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{title}</div>
          {description && <div className="text-xs text-muted-foreground">{description}</div>}
        </div>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </>
  );
  const className = "flex flex-wrap items-center gap-x-3 gap-y-3 rounded-lg p-3";
  return href ? <Link href={href} className={cn(className, "hover:bg-muted/50")}>{body}</Link> : <div className={className}>{body}</div>;
}

export function SettingsEmpty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg p-3 text-sm text-muted-foreground">{children}</p>;
}

export function AboutSection() {
  const { profile, dispatch, notify } = useApp();
  const [form, setForm] = useState({ name: profile.name, about: profile.about, people: profile.people });
  // Save is only offered when the form differs from what is saved.
  const changed = form.name.trim() !== profile.name || form.about.trim() !== profile.about || form.people.trim() !== profile.people;
  return (
    <SettingsSection id="about" title="About" description="The AI reads this before it ranks anything or writes a word.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!changed) return; dispatch({ type: "patchProfile", patch: { name: form.name.trim(), about: form.about.trim(), people: form.people.trim() } }); notify("Saved"); }}>
        <div className="grid gap-2"><Label htmlFor="name">Name</Label><Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid gap-2">
          <Label htmlFor="about">Role and Goals</Label>
          <Textarea id="about" rows={5} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="people">Important People</Label>
          <Textarea id="people" rows={4} value={form.people} onChange={(e) => setForm({ ...form, people: e.target.value })} />
          <p className="text-xs text-muted-foreground">Who they are to you, so the AI knows a one-line message from your co-founder outranks a long newsletter.</p>
        </div>
        <Button variant="secondary" type="submit" disabled={!changed}>Save</Button>
      </form>
    </SettingsSection>
  );
}

export function WritingSection() {
  const { writingExamples, dispatch, notify } = useApp();
  const [context, setContext] = useState("");
  const [text, setText] = useState("");
  // `required` lets whitespace through, so blank examples are refused here.
  const addExample = () => {
    const example = { context: context.trim(), text: text.trim() };
    if (!example.context || !example.text) return;
    dispatch({ type: "addExample", example: { id: `w-${Date.now()}`, ...example } });
    setContext("");
    setText("");
    notify("Example added");
  };
  return (
    <SettingsSection id="writing-style" title="Writing Style" description="Drafts copy how you already write to each person. These examples are used for people you have not written to yet.">
      {writingExamples.length > 0 && (
        <SettingsRows>
          {writingExamples.map((w) => (
            <SettingsRow key={w.id} title={w.context} description={w.text}>
              <Button variant="ghost" size="icon" aria-label={`Remove Example: ${w.context}`} onClick={() => { dispatch({ type: "removeExample", id: w.id }); notify("Example removed", () => dispatch({ type: "addExample", example: w })); }}><Trash2 /></Button>
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); addExample(); }}>
        <div className="grid gap-2"><Label htmlFor="ctx">Situation</Label><Input id="ctx" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Replying to a client" required /></div>
        <div className="grid gap-2"><Label htmlFor="txt">Example</Label><Textarea id="txt" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a message you actually sent" required /></div>
        <Button variant="secondary" type="submit">Add Example</Button>
      </form>
    </SettingsSection>
  );
}

// Reads ?add= so "Add Priority Rule" in a conversation can prefill the sender. Render inside <Suspense>.
export function PrioritiesSection() {
  const params = useSearchParams();
  const { rules, dispatch, notify } = useApp();
  const [target, setTarget] = useState(params.get("add") ?? "");
  const [kind, setKind] = useState<Rule["kind"]>("always_important");
  const addRule = () => {
    const value = target.trim();
    if (!value) return;
    if (rules.some((r) => r.target.toLowerCase() === value.toLowerCase())) return notify("That sender already has a rule");
    dispatch({ type: "addRule", rule: { id: `r-${Date.now()}`, kind, target: value } });
    setTarget("");
    notify("Rule added");
  };
  const groups: { kind: Rule["kind"]; title: string; blurb: string }[] = [
    { kind: "always_important", title: "Always Important", blurb: "Lands in Priority no matter what it says." },
    { kind: "never_important", title: "Never Important", blurb: "Kept out of Priority and push notifications." },
  ];
  return (
    <SettingsSection id="priorities" title="Priorities" description="Rules win over the AI. Add a sender address, a phone number or a whole domain. Marking a conversation Important or Not Important also teaches the ranking.">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); addRule(); }}>
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="name@example.com, +44… or example.com" aria-label="Sender Address, Phone Number or Domain" required className="flex-1" />
        <Select value={kind} onValueChange={(v) => setKind(v as Rule["kind"])}>
          <SelectTrigger className="sm:w-44" aria-label="Rule Type"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="always_important">Always Important</SelectItem><SelectItem value="never_important">Never Important</SelectItem></SelectContent>
        </Select>
        <Button variant="secondary" type="submit">Add</Button>
      </form>
      {groups.map((g) => {
        const list = rules.filter((r) => r.kind === g.kind);
        return (
          <SettingsSection key={g.kind} level={3} title={g.title} description={g.blurb}>
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

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <SettingsSection id="appearance" title="Appearance">
      <SettingsRows>
        <SettingsRow title="Theme" description="Match your device, or always use light or dark.">
          {mounted && (
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger className="w-32" aria-label="Theme"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent>
            </Select>
          )}
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}

const LANGUAGES = [
  { value: "auto", label: "Follow How I Write" },
  { value: "en-GB", label: "British English" },
  { value: "en-US", label: "American English" },
  { value: "af", label: "Afrikaans" },
] as const;

export function LanguageSection() {
  const { dispatch, profile } = useApp();
  return (
    <SettingsSection id="language" title="Language">
      <SettingsRows>
        <SettingsRow title="Summaries and Briefs" description="The language and spelling the AI writes in. Following how you write, it matches your own messages in each conversation, so it can differ between people.">
          <Select value={profile.language ?? "auto"} onValueChange={(v) => dispatch({ type: "patchProfile", patch: { language: v === "auto" ? null : (v as "en-GB" | "en-US" | "af") } })}>
            <SelectTrigger className="w-48" aria-label="Language"><SelectValue /></SelectTrigger>
            <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}

export function DataSection() {
  const { dispatch, profile } = useApp();
  return (
    <SettingsSection id="data" title="Data" description="Everything lives in your own database. Credentials and WhatsApp session keys are encrypted at rest, and message content never goes to logs.">
      <SettingsRows>
        <SettingsRow title="Share Usage Data" description="Counts of which screens and features are used, how long things take and how the AI did. Never message text, names, addresses or anything you type.">
          <Switch checked={profile.shareUsage} onCheckedChange={(v) => dispatch({ type: "patchProfile", patch: { shareUsage: v } })} aria-label="Share Usage Data" />
        </SettingsRow>
        <SettingsRow title="Delete All Data" description="Deleting everything is not available yet. To stop an account syncing now, use Pause Sync in Connected Accounts.">
          <Button variant="ghost" className="text-destructive hover:text-destructive" disabled>Delete Everything</Button>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}

export function TourSection() {
  const { notify } = useApp();
  const failed = () => notify("Could not start that. Try again.");
  const setup = () => saveOnboarding({ onboarding: "accounts", tour: "done" }).catch(failed);
  return (
    <SettingsSection id="tour" title="Getting Started">
      <SettingsRows>
        <SettingsRow title="Run Setup Again" description="Accounts, what Konva knows about you, contacts and a practice reply.">
          <Button variant="secondary" onClick={setup}>Run Setup</Button>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}

export function SignInSection() {
  const { session } = useAuth();
  return (
    <SettingsSection id="account" title="Account">
      <SettingsRows>
        <SettingsRow title="Signed In" description={session?.user.email}>
          <Button variant="secondary" onClick={() => signOut()}>Sign Out</Button>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}

/** Your own photo, shown wherever "You" appears. It is cut to a square and shrunk in the browser before it is saved. */
export function ProfilePhotoSection() {
  const { profile, dispatch } = useApp();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string>();
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function upload(file: File | undefined) {
    if (!file || !userId) return;
    setBusy(true);
    try {
      const blob = await squareJpeg(file);
      const path = photoPathFor(userId);
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (error) throw new Error("Your photo could not be uploaded. Try again.");
      dispatch({ type: "patchProfile", patch: { avatarPath: path } });
      setPreview(URL.createObjectURL(blob));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Your photo could not be uploaded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!userId) return;
    setBusy(true);
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([photoPathFor(userId)]);
    setBusy(false);
    if (error) { toast.error("Your photo could not be removed. Try again."); return; }
    dispatch({ type: "patchProfile", patch: { avatarPath: null } });
    setPreview(undefined);
  }

  return (
    <SettingsSection id="profile-photo" title="Profile Photo">
      <SettingsRows>
        <SettingsRow title="Your Photo" description="Shown beside the files and messages you send." leading={<MyAvatar className="size-12" previewUrl={preview} />}>
          <Button variant="secondary" disabled={busy} onClick={() => document.getElementById("profile-photo-input")?.click()}>Upload Photo</Button>
          {profile.avatarPath && <Button variant="ghost" disabled={busy} onClick={remove}>Remove</Button>}
          <input
            id="profile-photo-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void upload(f); }}
          />
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}
