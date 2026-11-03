"use client";

// Request Access: an office gives its name, size and a work email; one person gives an email only. It posts to
// /api/waitlist, which Admin reads. The hidden "website" field is a honeypot for bots, which the server answers
// like a success.

import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { TEAM_SIZES, checkRequest, type TeamSize, type WaitlistKind } from "@/lib/waitlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function RequestAccessForm({ className }: { className?: string }) {
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
      <div role="status" className={cn("flex flex-col items-start gap-2", className)}>
        <CircleCheck className="mb-2 size-6" aria-hidden />
        <p className="font-medium">Thanks, We Have Your Request</p>
        <p className="text-sm leading-6 text-muted-foreground">We will email {email.trim().toLowerCase()} within one working day{kind === "team" ? " to find a time to set up your office" : ""}.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className={cn("flex flex-col gap-5", className)}>
      <Tabs value={kind} onValueChange={(v) => { setKind(v as WaitlistKind); setError(null); }}>
        <TabsList className="w-full">
          <TabsTrigger value="team">For an Office</TabsTrigger>
          <TabsTrigger value="individual">Just for Me</TabsTrigger>
        </TabsList>
      </Tabs>
      {kind === "team" && (
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="request-company">Company</Label>
            <Input id="request-company" autoComplete="organization" placeholder="Sea Point Realty" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="request-size">Office Size</Label>
            <Select value={teamSize} onValueChange={(v) => setTeamSize(v as TeamSize)}>
              <SelectTrigger id="request-size" className="w-full"><SelectValue placeholder="Choose a Size" /></SelectTrigger>
              <SelectContent>{TEAM_SIZES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="request-email">{kind === "team" ? "Work Email" : "Email"}</Label>
        <Input id="request-email" type="email" autoComplete="email" placeholder="you@example.co.za" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={website} onChange={(e) => setWebsite(e.target.value)} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" disabled={busy}>{busy ? "Sending" : "Request Access"}</Button>
      <p className="text-xs leading-5 text-muted-foreground">We use your email only to reply to this request. See the <a href="/privacy" className="underline underline-offset-4 hover:text-foreground">Privacy Policy</a>.</p>
    </form>
  );
}
