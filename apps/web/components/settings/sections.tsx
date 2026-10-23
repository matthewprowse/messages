"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { signOut, useAuth } from "@/lib/auth";
import type { Rule } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The one heading style in Settings, for sections and the groups inside them alike.
export function SettingsHeading({ title, description, level = 2 }: { title: React.ReactNode; description?: React.ReactNode; level?: 2 | 3 | 4 }) {
  const Tag = `h${level}` as const;
  return (
    <div>
      <Tag className="text-sm font-medium">{title}</Tag>
      {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
    </div>
  );
}

export function SettingsSection({ id, title, description, level, children }: { id?: string; title: React.ReactNode; description?: React.ReactNode; level?: 2 | 3 | 4; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <SettingsHeading title={title} description={description} level={level} />
      {children}
    </section>
  );
}

// The one row style in Settings: a bordered list, each row a title and description with any controls on the right.
export function SettingsRows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y overflow-hidden rounded-lg border">{children}</div>;
}

export function SettingsRow({ title, description, leading, href, children }: { title: React.ReactNode; description?: React.ReactNode; leading?: React.ReactNode; href?: string; children?: React.ReactNode }) {
  const body = (
    <>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </>
  );
  const className = "flex items-center gap-4 px-4 py-3";
  return href ? <Link href={href} className={cn(className, "hover:bg-muted/50")}>{body}</Link> : <div className={className}>{body}</div>;
}

export function SettingsEmpty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">{children}</p>;
}

export function AboutSection() {
  const { profile, dispatch, notify } = useApp();
  const [form, setForm] = useState({ name: profile.name, about: profile.about, people: profile.people });
  return (
    <SettingsSection id="about" title="About" description="The AI reads this before it ranks anything or writes a word.">
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); dispatch({ type: "patchProfile", patch: form }); notify("Saved"); }}>
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
        <Button type="submit">Save</Button>
      </form>
    </SettingsSection>
  );
}

export function WritingSection() {
  const { writingExamples, dispatch, notify } = useApp();
  const [context, setContext] = useState("");
  const [text, setText] = useState("");
  return (
    <SettingsSection id="writing-style" title="Writing Style" description="Drafts copy how you already write to each person. These examples are used for people you have not written to yet.">
      {writingExamples.length > 0 && (
        <SettingsRows>
          {writingExamples.map((w) => (
            <SettingsRow key={w.id} title={w.context} description={w.text}>
              <Button variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => dispatch({ type: "removeExample", id: w.id })}><Trash2 /></Button>
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); dispatch({ type: "addExample", example: { id: `w-${Date.now()}`, context, text } }); setContext(""); setText(""); notify("Example added"); }}>
        <div className="grid gap-2"><Label htmlFor="ctx">Situation</Label><Input id="ctx" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Replying to a client" required /></div>
        <div className="grid gap-2"><Label htmlFor="txt">Example</Label><Textarea id="txt" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a message you actually sent" required /></div>
        <Button type="submit">Add Example</Button>
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
  const groups: { kind: Rule["kind"]; title: string; blurb: string }[] = [
    { kind: "always_important", title: "Always Important", blurb: "Lands in Priority no matter what it says." },
    { kind: "never_important", title: "Never Important", blurb: "Kept out of Priority and push notifications." },
  ];
  return (
    <SettingsSection id="priorities" title="Priorities" description="Rules win over the AI. Add a sender address, a phone number or a whole domain. Marking a conversation Important or Not Important also teaches the ranking.">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); dispatch({ type: "addRule", rule: { id: `r-${Date.now()}`, kind, target: target.trim() } }); setTarget(""); notify("Rule added"); }}>
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="name@example.com, +44… or example.com" required className="flex-1" />
        <Select value={kind} onValueChange={(v) => setKind(v as Rule["kind"])}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="always_important">Always Important</SelectItem><SelectItem value="never_important">Never Important</SelectItem></SelectContent>
        </Select>
        <Button type="submit">Add</Button>
      </form>
      {groups.map((g) => {
        const list = rules.filter((r) => r.kind === g.kind);
        return (
          <SettingsSection key={g.kind} level={3} title={g.title} description={g.blurb}>
            {list.length === 0 ? <SettingsEmpty>No rules yet.</SettingsEmpty> : (
              <SettingsRows>
                {list.map((r) => (
                  <SettingsRow key={r.id} title={r.target}>
                    <Button variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => dispatch({ type: "removeRule", id: r.id })}><Trash2 /></Button>
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

export function DataSection() {
  const { dispatch, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  return (
    <SettingsSection id="data" title="Data" description="Everything lives in your own database. Credentials and WhatsApp session keys are encrypted at rest, and message content never goes to logs.">
      <SettingsRows>
        <SettingsRow title="Export" description="Messages, contacts and AI notes as JSON.">
          <Button variant="outline" disabled>Coming Soon</Button>
        </SettingsRow>
        <SettingsRow title="Delete All Data" description="Disconnects every account and removes all stored messages, contacts and settings.">
          <Button variant="destructive" onClick={() => setOpen(true)}>Delete Everything</Button>
        </SettingsRow>
      </SettingsRows>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete All Data?</DialogTitle>
            <DialogDescription>This cannot be undone. Your email and WhatsApp accounts themselves are untouched; only this app's copy is removed. Type <span className="font-mono">delete</span> to confirm.</DialogDescription>
          </DialogHeader>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="delete" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={confirm !== "delete"} onClick={() => { dispatch({ type: "reset" }); setOpen(false); setConfirm(""); notify("All data deleted"); }}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

export function SignInSection() {
  const { session } = useAuth();
  return (
    <SettingsSection id="sign-in" title="Sign In">
      <SettingsRows>
        <SettingsRow title="Signed In" description={session?.user.email}>
          <Button variant="outline" onClick={() => signOut()}>Sign Out</Button>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}
