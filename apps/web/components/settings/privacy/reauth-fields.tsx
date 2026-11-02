"use client";

// The "prove it is you" part of Delete My Account: a code from the authenticator app when one is set up, else the password, with
// a way to get a code by email for someone who signs in by link or Google and has neither. Hands the proof up through
// `onChange`; null until it is complete. The server checks it (lib/server/reauth.ts); this only collects it.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { sendReauthCode, type Proof } from "@/lib/account-api";
import { cleanCode, verifiedTotp } from "@/lib/mfa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Method = "totp" | "password" | "email";

export function ReauthFields({ onChange }: { onChange: (proof: Proof | null) => void }) {
  const [method, setMethod] = useState<Method | null>(null); // null while checking for an authenticator app
  const [value, setValue] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.mfa.listFactors().then(({ data }) => { if (!cancelled) setMethod(verifiedTotp(data?.all).length > 0 ? "totp" : "password"); });
    return () => { cancelled = true; };
  }, []);

  const set = (next: string, as: Method | null = method) => {
    setValue(next);
    if (as === "password") onChange(next ? { method: "password", password: next } : null);
    else if (as) onChange(cleanCode(next) || /^\d{8}$/.test(next.replace(/\s/g, "")) ? { method: as, code: next } : null);
  };
  const switchTo = (next: Method) => { setMethod(next); setValue(""); onChange(null); };

  async function mailCode() {
    const error = await sendReauthCode();
    if (error) return toast.error(error);
    setSent(true);
    switchTo("email");
    toast.success("We have emailed you a code.");
  }

  if (!method) return <p className="text-sm text-muted-foreground">Checking how to confirm it is you…</p>;
  const label = method === "password" ? "Password" : method === "totp" ? "Authenticator Code" : "Emailed Code";
  return (
    <div className="grid gap-2">
      <Label htmlFor="reauth-value">{label}</Label>
      <Input
        id="reauth-value"
        type={method === "password" ? "password" : "text"}
        inputMode={method === "password" ? undefined : "numeric"}
        autoComplete={method === "password" ? "current-password" : "one-time-code"}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={method === "password" ? "" : "123456"}
      />
      {method === "email" && sent && <p className="text-xs text-muted-foreground">Enter the code we emailed you. It lasts a few minutes.</p>}
      {/* Someone with an authenticator app must use it: a mailbox alone must not be enough to delete their account. */}
      {method === "password" && (
        <Button type="button" variant="ghost" className="justify-self-start px-0" onClick={mailCode}>Email Me a Code Instead</Button>
      )}
      {method === "email" && (
        <Button type="button" variant="ghost" className="justify-self-start px-0" onClick={() => switchTo("password")}>Use My Password Instead</Button>
      )}
    </div>
  );
}
