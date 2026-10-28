"use client";

import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { TEAM_SIZES, checkRequest, type TeamSize, type WaitlistKind } from "@/lib/waitlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// Request access: a team gives its company, size and an email; an individual gives an email only. The
// hidden "website" field is a honeypot for bots, which the server answers like a success.
export function WaitlistForm({ id, className }: { id: string; className?: string }) {
  const [kind, setKind] = useState<WaitlistKind>("team");
  const [company, setCompany] = useState("");
  const [teamSize, setTeamSize] = useState<TeamSize | "">("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const request = { kind, email, company, teamSize, website };
    const checked = checkRequest(request);
    if (!checked.ok) return setError(checked.error);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      if (res.ok) return setDone(true);
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not save your request. Try again.");
    } catch {
      setError("Could not reach Konva. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div role="status" className={cn("flex flex-col items-center gap-2 rounded-xl border p-6 text-center", className)}>
        <CircleCheck className="size-6" />
        <p className="font-medium">You Are on the List</p>
        <p className="text-sm text-muted-foreground">We will email {email.trim().toLowerCase()} as soon as your access is ready.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className={cn("flex flex-col gap-4 text-left", className)}>
      <Tabs value={kind} onValueChange={(v) => { setKind(v as WaitlistKind); setError(null); }}>
        <TabsList className="w-full">
          <TabsTrigger value="team">For a Team</TabsTrigger>
          <TabsTrigger value="individual">Just for Me</TabsTrigger>
        </TabsList>
      </Tabs>
      {kind === "team" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-company`}>Company</Label>
            <Input id={`${id}-company`} autoComplete="organization" placeholder="Acme Properties" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-size`}>Team Size</Label>
            <Select value={teamSize} onValueChange={(v) => setTeamSize(v as TeamSize)}>
              <SelectTrigger id={`${id}-size`} className="w-full"><SelectValue placeholder="Choose a Size" /></SelectTrigger>
              <SelectContent>{TEAM_SIZES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-email`}>{kind === "team" ? "Work Email" : "Email"}</Label>
        <Input id={`${id}-email`} type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={website} onChange={(e) => setWebsite(e.target.value)} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Sending" : "Request Access"}</Button>
    </form>
  );
}
