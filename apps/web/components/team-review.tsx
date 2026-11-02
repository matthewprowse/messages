"use client";

// The first time someone loads the app after joining a team: a one-time dialog over the app with the chats Konva
// suggests as work, to share or skip in one go. It reads only what is already synced in the browser (the same chats
// the list shows), so nothing opens a chat on a phone or sends a read receipt. Whether it was answered is kept in the
// sign-in's user metadata (teamReview), like the setup dialog's progress, so it follows them to every device.

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { relTime } from "@/lib/format";
import { saveOnboarding, useOnboardingMeta } from "@/lib/onboarding";
import { acceptSuggestions, useMyTeam } from "@/lib/share";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { ProviderLogo } from "@/components/provider-logo";
import { ShareFromField, shareFromOf, type ShareChoice } from "@/components/share-dialog";

/** Only people who joined recently are asked: a suggestion from months later is just a notice on its chat. */
const RECENT_DAYS = 14;
/** The list shows the newest of the suggested chats; the rest stay suggested on their own chats. */
const MAX_LISTED = 100;

/** Pages it stays out of the way on: signing in and setting up an account in Settings. */
const AWAY = (path: string) => path === "/login" || path.startsWith("/settings/accounts") || path.startsWith("/invite");

export function TeamReview() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const team = useMyTeam();
  const meta = useOnboardingMeta();
  const pathname = usePathname();
  const { threads, contactById } = useApp();

  const pending = !!team && meta.teamReview !== team.workspaceId;
  // When they joined, read once. Not known (or not recent) means no dialog.
  const [joinedAt, setJoinedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!userId || !pending) return;
    let cancelled = false;
    void supabase.from("workspace_members").select("joined_at").eq("user_id", userId).eq("status", "active").maybeSingle()
      .then(({ data }) => { if (!cancelled) setJoinedAt(data?.joined_at ?? null); });
    return () => { cancelled = true; };
  }, [userId, pending]);

  const suggested = useMemo(
    () => threads.filter((t) => t.shareSuggestion === "suggested" && !t.workspaceId && t.status !== "trash")
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)).slice(0, MAX_LISTED),
    [threads],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState<ShareChoice>("whole");
  const [date, setDate] = useState<Date | undefined>();
  const [busy, setBusy] = useState(false);

  const recent = !!joinedAt && Date.now() - Date.parse(joinedAt) < RECENT_DAYS * 86_400_000;
  // Setup comes first for someone brand new.
  const settled = !meta.onboarding || meta.onboarding === "done";
  const open = !!userId && pending && recent && settled && !AWAY(pathname) && suggested.length > 0;
  if (!open || !team) return null;

  const title = (t: (typeof suggested)[number]) => (t.isGroup ? t.groupName : contactById(t.participantIds[0] ?? "")?.name ?? t.fallbackName) || "Unknown";
  const toggle = (id: string, on: boolean) => setSelected((s) => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next; });
  const all = selected.size === suggested.length;
  const ready = !busy && selected.size > 0 && (choice !== "date" || !!date);

  const finish = async () => {
    try {
      await saveOnboarding({ teamReview: team.workspaceId });
    } catch {
      toast.error("Something went wrong. Try again.");
    }
  };
  const share = async () => {
    if (!ready) return;
    setBusy(true);
    const result = await acceptSuggestions([...selected], shareFromOf(choice, date));
    if ("problem" in result) {
      setBusy(false);
      return void toast.error(result.problem);
    }
    toast(result.shared === 1 ? "Marked 1 chat as work" : `Marked ${result.shared} chats as work`);
    await finish();
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) void finish(); }}>
      <DialogContent showCloseButton={false} track="team_review" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review Your Work Chats</DialogTitle>
          <DialogDescription>
            Konva found chats that look like work. Nothing is shared until you choose. Your team can read what you share, and so can anyone you or an owner or admin assign a chat to. Everything else stays private to you.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border">
          <div className="flex items-center gap-3 px-3 py-2">
            <Checkbox id="review-all" checked={all} onCheckedChange={(on) => setSelected(on ? new Set(suggested.map((t) => t.id)) : new Set())} />
            <Label htmlFor="review-all" className="flex-1 text-sm font-medium">Select All</Label>
            <span className="text-xs text-muted-foreground">{selected.size} of {suggested.length}</span>
          </div>
          <Separator />
          <ScrollArea className="h-64">
            {suggested.map((t, i) => (
              <div key={t.id}>
                {i > 0 && <Separator />}
                <Label htmlFor={`review-${t.id}`} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 font-normal">
                  <Checkbox id={`review-${t.id}`} checked={selected.has(t.id)} onCheckedChange={(on) => toggle(t.id, on === true)} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{title(t)}</span>
                  <ProviderLogo provider={t.provider} />
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relTime(t.lastMessageAt, new Date())}</span>
                </Label>
              </div>
            ))}
          </ScrollArea>
        </div>
        <ShareFromField choice={choice} onChoice={setChoice} date={date} onDate={setDate} idPrefix="review" />
        {team.strict && (
          <p className="text-sm">
            Strict sharing is on for your team. Once a chat is shared it stays shared until an owner or admin releases it, so this cannot be undone. People with the Compliance role can read it.
          </p>
        )}
        <div className={DIALOG_BUTTONS}>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void finish()}>Skip for Now</Button>
          <Button type="button" disabled={!ready} onClick={() => void share()}>{busy ? "Sharing" : "Share Selected"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
