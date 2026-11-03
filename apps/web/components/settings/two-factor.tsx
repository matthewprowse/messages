"use client";

// Settings, Profile, Two Factor Sign In: add, check and remove an authenticator app (TOTP, Supabase Auth MFA). With a verified
// factor, signing in asks for a six digit code and /api/keys only opens your messages for a session that passed it.
// Removing the factor asks for a current code first (an aal2 session), so a stolen session cannot switch it off.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cleanCode, verifiedTotp } from "@/lib/mfa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

interface Enrolment { id: string; qr: string; secret: string }

export function TwoFactorSection() {
  const [factorId, setFactorId] = useState<string | null | undefined>(undefined); // undefined while loading
  const [enrol, setEnrol] = useState<Enrolment | null>(null);
  const [removing, setRemoving] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactorId(verifiedTotp(data?.all)[0]?.id ?? null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const close = () => { setEnrol(null); setRemoving(false); setCode(""); setError(null); };

  async function start() {
    setBusy(true);
    setError(null);
    // A half finished enrolment from an earlier try would block a new one with the same name, so clear those first.
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of all?.all ?? []) if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator App" });
    setBusy(false);
    if (error || !data) return toast.error("Two factor sign in could not be started. Try again.");
    setEnrol({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  // Challenge and verify in one go. For enrolment this activates the factor; for removal it lifts the session to aal2.
  async function verify(id: string): Promise<boolean> {
    const digits = cleanCode(code);
    if (!digits) { setError("Enter the six digit code from your app."); return false; }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: digits });
    setBusy(false);
    if (error) { setError("That code did not match. Wait for a new one and try again."); return false; }
    return true;
  }

  async function confirmEnrol() {
    if (!enrol || !(await verify(enrol.id))) return;
    toast.success("Two factor sign in is on.");
    close();
    await load();
  }

  async function confirmRemove() {
    if (!factorId || !(await verify(factorId))) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (error) return setError("Two factor sign in could not be removed. Try again.");
    toast.success("Two factor sign in is off.");
    close();
    await load();
  }

  const open = !!enrol || removing;
  const codeField = (
    <div className="grid gap-2">
      <Label htmlFor="mfa-code">Code</Label>
      <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );

  return (
    <SettingsSection id="two-factor" title="Two Factor Sign In">
      <SettingsRows>
        <SettingsRow title="Authenticator App" description={factorId === undefined ? "Checking" : factorId ? "On" : "Off"}>
          {factorId === null && <Button variant="secondary" disabled={busy} onClick={start}>Turn On</Button>}
          {factorId && <Button variant="secondary" onClick={() => setRemoving(true)}>Turn Off</Button>}
        </SettingsRow>
      </SettingsRows>

      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent showCloseButton={false} className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
          {enrol ? (
            <form onSubmit={(e) => { e.preventDefault(); void confirmEnrol(); }} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Add an Authenticator App</DialogTitle>
              </DialogHeader>
              {/* A data: SVG made by Supabase, shown as an image so it cannot run anything. */}
              <img src={enrol.qr} alt="QR code for your authenticator app" className="mx-auto size-44 rounded-lg border bg-white p-2" />
              <p className="break-all text-center text-xs text-muted-foreground">Or enter this key by hand: <span className="font-mono">{enrol.secret}</span></p>
              {codeField}
              <div className={DIALOG_BUTTONS}>
                <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? "Checking…" : "Turn On"}</Button>
              </div>
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void confirmRemove(); }} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Turn Off Two Factor Sign In</DialogTitle>
              </DialogHeader>
              {codeField}
              <div className={DIALOG_BUTTONS}>
                <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
                <Button type="submit" variant="destructive" disabled={busy}>{busy ? "Checking…" : "Turn Off"}</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
