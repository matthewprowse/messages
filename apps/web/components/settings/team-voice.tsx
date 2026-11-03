"use client";

// Settings, Team, Company Voice: the team's tone, sign-off, templates and facts, read by everyone and edited by owners and admins.

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteVoiceItem, LIMITS, PROFILE_PARTS, saveProfilePart, saveVoiceItem, useCompanyVoice, type CompanyVoice, type ProfileSlot, type VoiceItem } from "@/lib/company-voice";
import type { TeamState } from "@/lib/team";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

const snip = (text: string, n = 110) => (text.length > n ? `${text.slice(0, n).trimEnd()}...` : text);

/** How the business writes: tone, sign-off, and what to always and never say. Read by everyone, saved by an owner or admin. */
function ProfileSection({ voice, manages, reload }: { voice: CompanyVoice; manages: boolean; reload: () => void }) {
  const [form, setForm] = useState<Record<ProfileSlot, string>>({ tone: "", sign_off: "", always: "", never: "" });
  const [busy, setBusy] = useState(false);
  // Copied when the saved profile arrives or changes, not while someone is typing.
  const saved = JSON.stringify(PROFILE_PARTS.map((p) => voice.profile[p.slot].text));
  useEffect(() => {
    setForm({ tone: voice.profile.tone.text, sign_off: voice.profile.sign_off.text, always: voice.profile.always.text, never: voice.profile.never.text });
  }, [saved, voice.profile]);
  const changed = PROFILE_PARTS.some((p) => form[p.slot].trim() !== voice.profile[p.slot].text.trim());

  const save = async () => {
    setBusy(true);
    let failed: string | null = null;
    for (const p of PROFILE_PARTS) {
      if (form[p.slot].trim() === voice.profile[p.slot].text.trim()) continue;
      failed = await saveProfilePart(p.slot, voice.profile[p.slot].id, form[p.slot]);
      if (failed) break;
    }
    setBusy(false);
    if (failed) toast.error(failed);
    else toast("Saved");
    reload();
  };

  return (
    <SettingsSection
      id="company-profile"
      title="How the Business Writes"
      description="The AI reads this with each draft in a work chat. A person's own style still decides the wording, and these rules decide what a reply must and must not say."
    >
      {manages ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (changed && !busy) void save(); }}>
          {PROFILE_PARTS.map((p) => (
            <div key={p.slot} className="grid gap-2">
              <Label htmlFor={`voice-${p.slot}`}>{p.label}</Label>
              {p.lines ? (
                <Textarea id={`voice-${p.slot}`} rows={4} maxLength={p.max} value={form[p.slot]} placeholder={p.placeholder} disabled={busy} onChange={(e) => setForm({ ...form, [p.slot]: e.target.value })} />
              ) : (
                <Input id={`voice-${p.slot}`} maxLength={p.max} value={form[p.slot]} placeholder={p.placeholder} disabled={busy} onChange={(e) => setForm({ ...form, [p.slot]: e.target.value })} />
              )}
              <p className="text-xs text-muted-foreground">{p.hint}</p>
            </div>
          ))}
          <Button variant="secondary" type="submit" disabled={!changed || busy}>{busy ? "Saving" : "Save"}</Button>
        </form>
      ) : PROFILE_PARTS.some((p) => voice.profile[p.slot].text) ? (
        <SettingsRows>
          {PROFILE_PARTS.filter((p) => voice.profile[p.slot].text).map((p) => (
            <SettingsRow key={p.slot} title={p.label} description={<span className="whitespace-pre-line">{voice.profile[p.slot].text}</span>} />
          ))}
        </SettingsRows>
      ) : (
        <SettingsEmpty>The owner has not described how the business writes yet.</SettingsEmpty>
      )}
    </SettingsSection>
  );
}

/** A dialog to add or change a template or a company fact. */
function ItemDialog({ kind, item, open, onClose, onSaved }: { kind: "template" | "fact"; item: VoiceItem | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const template = kind === "template";
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setTitle(item?.title ?? ""); setBody(item?.body ?? ""); }
  }, [open, item]);
  const titleMax = template ? LIMITS.name : LIMITS.factTitle;
  const bodyMax = template ? LIMITS.template : LIMITS.fact;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !title.trim() || !body.trim()) return;
    setBusy(true);
    const failed = await saveVoiceItem(kind, item?.id ?? null, title, body);
    setBusy(false);
    if (failed) return void toast.error(failed);
    toast(item ? "Saved" : template ? "Template added" : "Fact added");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent track={template ? "company_template" : "company_fact"} className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>{item ? (template ? "Edit Template" : "Edit Fact") : template ? "Add Template" : "Add Fact"}</DialogTitle>
            <DialogDescription>
              {template
                ? `Anyone on the team can insert it into a reply in a work chat. The AI also reads the first ${LIMITS.templateRead} characters as approved wording.`
                : "A short entry the AI can quote exactly when a reply needs it, such as a price, a listing, office hours or an answer to a common question."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="voice-item-title">{template ? "Name" : "Title"}</Label>
            <Input id="voice-item-title" autoFocus maxLength={titleMax} value={title} disabled={busy} placeholder={template ? "Viewing Request" : "Office Hours"} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="voice-item-body">{template ? "Text" : "Fact"}</Label>
            <Textarea id="voice-item-body" rows={template ? 6 : 4} maxLength={bodyMax} value={body} disabled={busy} placeholder={template ? "Thanks for your interest. When would suit you to view it?" : "8 to 5 on weekdays, closed on public holidays"} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className={DIALOG_BUTTONS}>
            <Button type="submit" variant="secondary" disabled={busy || !title.trim() || !body.trim()}>{busy ? "Saving" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Templates or company facts, as a list with add, edit and remove for an owner or admin. */
function ItemsSection({ kind, items, manages, reload }: { kind: "template" | "fact"; items: VoiceItem[]; manages: boolean; reload: () => void }) {
  const template = kind === "template";
  const [editing, setEditing] = useState<VoiceItem | null | "new">(null);
  const [removing, setRemoving] = useState<VoiceItem | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const failed = await deleteVoiceItem(removing.id);
    setBusy(false);
    if (failed) return void toast.error(failed);
    toast(template ? "Template removed" : "Fact removed");
    setRemoving(null);
    reload();
  };

  return (
    <SettingsSection
      id={template ? "company-templates" : "company-facts"}
      title={template ? "Templates" : "Company Facts"}
      description={template
        ? "Messages the business sends often. Anyone can insert one into a reply in a work chat from the reply box."
        : "Short entries such as prices, listings, office hours and answers to common questions. The AI quotes them exactly, and only in a work chat."}
    >
      {manages && (
        <Button variant="secondary" onClick={() => setEditing("new")}><Plus /> {template ? "Add Template" : "Add Fact"}</Button>
      )}
      {items.length === 0 ? (
        <SettingsEmpty>{template ? "No templates yet." : "No company facts yet."}</SettingsEmpty>
      ) : (
        <SettingsRows>
          {items.map((i) => (
            <SettingsRow key={i.id} title={i.title} description={snip(i.body)}>
              {manages && (
                <>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${i.title}`} onClick={() => setEditing(i)}><Pencil /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${i.title}`} onClick={() => setRemoving(i)}><Trash2 /></Button>
                </>
              )}
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      <ItemDialog kind={kind} item={editing === "new" ? null : editing} open={editing !== null} onClose={() => setEditing(null)} onSaved={reload} />
      <AlertDialog open={!!removing} onOpenChange={(open) => !busy && !open && setRemoving(null)}>
        <AlertDialogContent track={template ? "remove_template" : "remove_fact"}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              {template ? "It is no longer offered in the reply box, and the AI stops using it." : "The AI stops using it."} This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className={DIALOG_BUTTONS}>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={(e) => { e.preventDefault(); void remove(); }}>{busy ? "Removing" : "Remove"}</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

/** Settings, Team, Company Voice: the team's profile, templates and facts. Everyone reads it; an owner or admin edits it. */
export function CompanyVoiceSections({ team }: { team: TeamState }) {
  const { voice, reload } = useCompanyVoice();
  const manages = team.role === "owner" || team.role === "admin";
  if (voice === undefined) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (voice === null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could Not Load the Company Voice</AlertTitle>
        <AlertDescription>
          <p>Check your connection and try again.</p>
          <Button variant="secondary" className="mt-2" onClick={reload}>Retry</Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <>
      <ProfileSection voice={voice} manages={manages} reload={reload} />
      <ItemsSection kind="template" items={voice.templates} manages={manages} reload={reload} />
      <ItemsSection kind="fact" items={voice.facts} manages={manages} reload={reload} />
    </>
  );
}
