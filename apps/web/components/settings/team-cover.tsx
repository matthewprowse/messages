"use client";

// Settings, Team, Cover: set who is away, who covers and for which dates. Members set their own, owners and admins anyone's.

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { coverState, endCover, endOfDay, lastDay, setCover, startOfDay, useCover, type CoverPeriod } from "@/lib/team-cover";
import type { TeamState } from "@/lib/team";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { SettingsEmpty, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";
import { IconAction } from "@/components/tip";

const day = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A dialog to set cover: who is away, who covers, and the dates. A member sets their own; an owner or admin anyone's. */
function CoverDialog({ team, userId, open, onClose, onSaved }: { team: TeamState; userId: string; open: boolean; onClose: () => void; onSaved: () => void }) {
  const manages = team.role === "owner" || team.role === "admin";
  const people = team.people.filter((p): p is typeof p & { userId: string } => p.status === "active" && !!p.userId);
  const nameOf = (id: string) => (id === userId ? "Me" : people.find((p) => p.userId === id)?.name || people.find((p) => p.userId === id)?.email || "Someone");
  const [absent, setAbsent] = useState(userId);
  const [cover, setCover_] = useState("");
  const today = iso(new Date());
  const [from, setFrom] = useState(today);
  const [through, setThrough] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => { onClose(); setTimeout(() => { setAbsent(userId); setCover_(""); setFrom(iso(new Date())); setThrough(""); }, 200); };
  const valid = !!cover && !!from && !!through && cover !== absent && endOfDay(through) > startOfDay(from);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const failed = await setCover(absent, cover, from, through);
    setBusy(false);
    if (failed) return void toast.error(failed);
    toast("Cover is set");
    onSaved();
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && close()}>
      <DialogContent track="set_cover" showCloseButton={false} className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>Set Cover</DialogTitle>
            <DialogDescription>
              From the first date to the end of the last, the person covering reads {absent === userId ? "your" : `${nameOf(absent)}'s`} work chats and answers them from their own account, never from {absent === userId ? "yours" : "theirs"}. Personal chats are never covered. It ends by itself.
            </DialogDescription>
          </DialogHeader>
          {manages && (
            <div className="grid gap-2">
              <Label htmlFor="cover-absent">Who Is Away</Label>
              <Select value={absent} onValueChange={(v) => { setAbsent(v); if (v === cover) setCover_(""); }}>
                <SelectTrigger id="cover-absent" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{people.map((p) => <SelectItem key={p.userId} value={p.userId}>{nameOf(p.userId)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="cover-by">Who Covers</Label>
            <Select value={cover} onValueChange={setCover_}>
              <SelectTrigger id="cover-by" className="w-full"><SelectValue placeholder="Choose Someone" /></SelectTrigger>
              <SelectContent>
                {people.filter((p) => p.userId !== absent && p.role !== "compliance").map((p) => <SelectItem key={p.userId} value={p.userId}>{nameOf(p.userId)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="cover-from">From</Label>
              <Input id="cover-from" type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cover-through">Until, Including</Label>
              <Input id="cover-through" type="date" min={from || today} value={through} onChange={(e) => setThrough(e.target.value)} />
            </div>
          </div>
          <div className={DIALOG_BUTTONS}>
            <Button variant="ghost" type="button" disabled={busy} onClick={close}>Cancel</Button>
            <Button variant="secondary" type="submit" disabled={!valid || busy}>{busy ? "Setting" : "Set Cover"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Cover: set it, see it, end it early. Everyone sets their own; an owner or admin sets anyone's. */
export function CoverSection({ team, userId }: { team: TeamState; userId: string }) {
  const { periods, reload } = useCover();
  const [setting, setSetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const manages = team.role === "owner" || team.role === "admin";
  const nameOf = (id: string) => (id === userId ? "You" : team.people.find((p) => p.userId === id)?.name || team.people.find((p) => p.userId === id)?.email || "A former member");
  const canSet = team.role !== null && team.people.some((p) => p.status === "active" && p.userId && p.userId !== userId && p.role !== "compliance");

  const end = async (p: CoverPeriod) => {
    setBusy(true);
    const failed = await endCover(p.id);
    setBusy(false);
    if (failed) return void toast.error(failed);
    toast("Cover ended");
    reload();
  };

  // What is still running or to come first, then the record.
  const shown = (periods ?? []).filter((p) => manages || p.absentId === userId || p.coverId === userId);
  const live = shown.filter((p) => ["active", "upcoming"].includes(coverState(p)));
  const past = shown.filter((p) => !live.includes(p)).slice(0, 5);

  return (
    <SettingsSection id="cover" title="Cover" action={<IconAction label="Set Cover" icon={CalendarClock} disabled={!canSet} onClick={() => setSetting(true)} />}>
      {periods === null ? (
        <SettingsEmpty>Cover did not load. Reload the page to try again.</SettingsEmpty>
      ) : periods === undefined ? null : shown.length === 0 ? (
        <SettingsEmpty>No one is covering anyone.</SettingsEmpty>
      ) : (
        <SettingsRows>
          {[...live, ...past].map((p) => {
            const state = coverState(p);
            const mayEnd = (state === "active" || state === "upcoming") && (manages || p.absentId === userId || p.coverId === userId);
            return (
              <SettingsRow
                key={p.id}
                title={
                  <>
                    {nameOf(p.coverId)} {p.coverId === userId ? "cover" : "covers"} {p.absentId === userId ? "you" : nameOf(p.absentId)}
                    <Badge variant={state === "active" ? "secondary" : "outline"}>{state === "active" ? "Active" : state === "upcoming" ? "Starts Later" : state === "ended_early" ? "Ended Early" : "Ended"}</Badge>
                  </>
                }
                description={`${day(p.startsAt)} to ${day(lastDay(p))}`}
              >
                {mayEnd && <Button variant="secondary" disabled={busy} onClick={() => void end(p)}>{state === "upcoming" ? "Cancel" : "End Cover"}</Button>}
              </SettingsRow>
            );
          })}
        </SettingsRows>
      )}
      <CoverDialog team={team} userId={userId} open={setting} onClose={() => setSetting(false)} onSaved={reload} />
    </SettingsSection>
  );
}
