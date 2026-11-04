"use client";

// One page to sign in and to sign up. No password to make up: Google, or a code sent to your email (the
// email's link works too). An account with a password set can still use it. An account with two-factor sign-in on
// is asked for its authenticator code after that first step (useAuth().mfaRequired), before it counts as signed in.
// Only approved emails can create an account (the database refuses the rest, lib/signup-refusal.ts): a refused email or
// Google sign-in is told so, with the way to ask for access.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { signOut, useAuth } from "@/lib/auth";
import { cleanCode, verifiedTotp } from "@/lib/mfa";
import { INVITE_KEY } from "@/lib/team";
import { authErrorInUrl, isRefusedSignup } from "@/lib/signup-refusal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldSeparator } from "@/components/ui/field";
import { GoogleLogo } from "@/components/provider-logo";

type Mode = "email" | "code" | "password";

/** The invite page waiting for this sign-in, left by that page in this browser. */
function pendingInvite(): string | null {
  try {
    const token = localStorage.getItem(INVITE_KEY);
    return token && /^[0-9a-f]{64}$/.test(token) ? `/invite/${token}` : null;
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { session, mfaRequired } = useAuth();
  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);

  // Back from Google with an error: a new account the database refused, or Google sign-in failing. The address is cleaned so a
  // reload does not show it again.
  useEffect(() => {
    const problem = authErrorInUrl(window.location.search, window.location.hash);
    if (!problem) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (isRefusedSignup(problem)) setRefused(true);
    else setError("Google sign-in did not work. Try again, or use your email instead.");
  }, []);

  // Into the app, or back to the team invite they were sent to sign in for. Someone new finds the setup dialog open over it.
  useEffect(() => {
    if (!session) return;
    router.replace(pendingInvite() ?? "/summary");
  }, [session, router]);

  const challenge = () => run(async () => {
    const digits = cleanCode(code);
    if (!digits) return "Enter the six digit code from your authenticator app.";
    const { data: list } = await supabase.auth.mfa.listFactors();
    const factor = verifiedTotp(list?.all)[0];
    if (!factor) return "No authenticator app was found. Sign out and try again.";
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: digits });
    return error ? "That code did not match. Wait for a new one and try again." : null;
  });

  // The email code just used must not sit in the field when the authenticator code is asked for.
  useEffect(() => { if (mfaRequired) { setCode(""); setError(null); } }, [mfaRequired]);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setRefused(false);
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
    if (error && isRefusedSignup(error.message)) {
      setRefused(true);
      return null;
    }
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
    if (mfaRequired) void challenge();
    else if (mode === "email") void sendCode();
    else if (mode === "code") void verify();
    else void signInWithPassword();
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6">
        <div>
          <p className="text-sm font-semibold tracking-tight">Konva</p>
          {mfaRequired ? (
            <>
              <h1 className="flex h-10 items-center text-lg font-medium">Two-Factor Sign-In</h1>
              <p className="text-sm text-muted-foreground">Enter the six digit code from your authenticator app.</p>
            </>
          ) : mode === "code" ? (
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

        {!mfaRequired && mode !== "code" && (
          <>
            <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={google}>
              <GoogleLogo /> Continue With Google
            </Button>
            <FieldSeparator>Or</FieldSeparator>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </>
        )}

        {(mode === "code" || mfaRequired) && (
          <div className="grid gap-2">
            <Label htmlFor="code">Code</Label>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
        )}

        {!mfaRequired && mode === "password" && (
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {refused && (
          <div role="alert" className="space-y-1 text-sm">
            <p className="font-medium">This Email Is Not On The Approved List Yet</p>
            <p className="text-muted-foreground">Konva is open to approved emails and team invites for now. <Link href="/request-access" className="underline underline-offset-4">Join the Waitlist</Link></p>
          </div>
        )}

        <div className="space-y-2">
          <Button type="submit" className="w-full" disabled={busy}>
            {mfaRequired ? (busy ? "Checking…" : "Verify") : mode === "email" ? (busy ? "Sending…" : "Continue With Email") : mode === "code" ? (busy ? "Checking…" : "Continue") : busy ? "Signing In…" : "Sign In"}
          </Button>
          {mfaRequired ? (
            <Button type="button" variant="link" className="w-full" onClick={() => { setCode(""); setError(null); void signOut(); }}>Sign Out</Button>
          ) : mode === "code" ? (
            <div className="flex justify-between">
              <Button type="button" variant="link" className="px-0" onClick={() => { setMode("email"); setError(null); }}>Use a Different Email</Button>
              <Button type="button" variant="link" className="px-0" disabled={busy} onClick={sendCode}>Send a New Code</Button>
            </div>
          ) : (
            <Button type="button" variant="link" className="w-full" onClick={() => { setMode(mode === "password" ? "email" : "password"); setError(null); }}>
              {mode === "password" ? "Email Me a Code Instead" : "Sign In With a Password"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
