"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldSeparator } from "@/components/ui/field";
import { GoogleLogo } from "@/components/provider-logo";

type Mode = "email" | "code" | "password";

// One page to sign in and to sign up. No password to make up: Google, or a code sent to your email (the
// email's link works too). An account with a password set can still use it.
export default function LoginPage() {
  const router = useRouter();
  const { session } = useAuth();
  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Into the app. Someone new finds the setup dialog open over it.
  useEffect(() => {
    if (session) router.replace("/briefing");
  }, [session, router]);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      setError(await work());
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const google = () => run(async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/login` } });
    return error ? "Google sign-in is not available right now. Use your email instead." : null;
  });

  const sendCode = () => run(async () => {
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/login` } });
    if (error) return error.status === 429 ? "Too many emails sent. Wait a minute and try again." : "That email could not be used. Check it and try again.";
    setCode("");
    setMode("code");
    return null;
  });

  const verify = () => run(async () => {
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.replace(/\D/g, ""), type: "email" });
    return error ? "That code did not match, or it has expired. Check the latest email, or send a new code." : null;
  });

  const signInWithPassword = () => run(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? "That email and password did not match." : null;
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "email") void sendCode();
    else if (mode === "code") void verify();
    else void signInWithPassword();
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6">
        <div>
          <p className="text-sm font-semibold tracking-tight">Konva</p>
          {mode === "code" ? (
            <>
              <h1 className="flex h-10 items-center text-lg font-medium">Check Your Email</h1>
              <p className="text-sm text-muted-foreground">We sent a code to {email.trim()}. Enter it here, or open the link in the email.</p>
            </>
          ) : (
            <>
              <h1 className="flex h-10 items-center text-lg font-medium">Sign In or Create an Account</h1>
              <p className="text-sm text-muted-foreground">Every client conversation, in one place.</p>
            </>
          )}
        </div>

        {mode !== "code" && (
          <>
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={google}>
              <GoogleLogo /> Continue With Google
            </Button>
            <FieldSeparator>Or</FieldSeparator>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </>
        )}

        {mode === "code" && (
          <div className="grid gap-2">
            <Label htmlFor="code">Code</Label>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
        )}

        {mode === "password" && (
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <div className="space-y-2">
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "email" ? (busy ? "Sending…" : "Continue With Email") : mode === "code" ? (busy ? "Checking…" : "Continue") : busy ? "Signing In…" : "Sign In"}
          </Button>
          {mode === "code" ? (
            <div className="flex justify-between">
              <Button type="button" variant="link" size="sm" className="px-0" onClick={() => { setMode("email"); setError(null); }}>Use a Different Email</Button>
              <Button type="button" variant="link" size="sm" className="px-0" disabled={busy} onClick={sendCode}>Send a New Code</Button>
            </div>
          ) : (
            <Button type="button" variant="link" size="sm" className="w-full" onClick={() => { setMode(mode === "password" ? "email" : "password"); setError(null); }}>
              {mode === "password" ? "Email Me a Code Instead" : "Sign In With a Password"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
