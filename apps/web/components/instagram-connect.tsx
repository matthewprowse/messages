"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { track } from "@/lib/analytics";
import { postAsUser } from "@/lib/onboarding";
import { useApp } from "@/lib/store";
import { SettingsHeading, SettingsRow, SettingsRows } from "@/components/settings/sections";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Step = { step: "code" | "two_factor"; method: "email" | "sms" | "app" | null; attempts: number } | null;

const STEP_POLL_MS = 3_000;

/**
 * Connects Instagram with a username and password. The Instagram connector signs in and, when Instagram asks
 * for a code, says so here; the code typed is handed back to it. The account's status comes live from the store.
 */
export function InstagramConnect() {
  const { accounts } = useApp();
  const account = accounts.find((a) => a.provider === "instagram");
  const [accountId, setAccountId] = useState<string | null>(null);
  const id = accountId ?? account?.id ?? null;
  const current = accounts.find((a) => a.id === id) ?? account;
  const status = current?.status;
  // Just connected: signing in, until the account's own status says so too.
  const [waiting, setWaiting] = useState(false);
  useEffect(() => { if (status === "connecting") setWaiting(false); }, [status]);
  const signingIn = status === "connecting" || waiting;
  const linked = status === "connected" || status === "syncing";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While signing in, whether Instagram has asked for a code. Checked every few seconds.
  const checkStep = useCallback(async () => {
    if (!id) return;
    try {
      const result = await postAsUser<{ step: Step }>("/api/connect/instagram/code", { accountId: id });
      setStep((prev) => {
        if (prev?.attempts !== result.step?.attempts || prev?.step !== result.step?.step) setSent(false);
        return result.step;
      });
    } catch {
      // Tried again on the next tick.
    }
  }, [id]);

  useEffect(() => {
    if (!signingIn) {
      setStep(null);
      return;
    }
    void checkStep();
    const t = setInterval(() => void checkStep(), STEP_POLL_MS);
    return () => clearInterval(t);
  }, [signingIn, checkStep]);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await postAsUser<{ accountId: string }>("/api/connect/instagram", { username, password });
      setAccountId(result.accountId);
      setWaiting(true);
      setPassword("");
      track("account_connect", { provider: "instagram", step: "app", outcome: "done" });
    } catch (err) {
      track("account_connect", { provider: "instagram", step: "app", outcome: "failed" });
      setError(err instanceof Error ? err.message : "Instagram could not be connected. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await postAsUser("/api/connect/instagram/code", { accountId: id, code });
      setCode("");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The code could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (linked) {
    return (
      <SettingsRows>
        <SettingsRow
          title={<>Instagram <Badge variant="secondary">{status === "syncing" ? "Importing" : "Connected"}</Badge></>}
          description={status === "syncing" ? "Your recent Instagram chats are importing." : "New messages appear in the Inbox within a few minutes."}
        />
      </SettingsRows>
    );
  }

  if (signingIn && step) {
    return (
      <form onSubmit={submitCode} className="space-y-4 rounded-lg border p-4">
        <SettingsHeading title="Enter the Code Instagram Sent You" description={current?.statusDetail ?? "Enter the code Instagram sent you."} />
        <FieldGroup>
          <Field className="max-w-xs">
            <FieldLabel htmlFor="instagram-code">{step.step === "two_factor" ? "Two-Factor Code" : "Security Code"}</FieldLabel>
            <Input id="instagram-code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} disabled={sent} required />
            <FieldDescription>{sent ? "Checking the code with Instagram." : "The code is only used for this sign-in and is not kept."}</FieldDescription>
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <div>
            <Button type="submit" disabled={busy || sent || code.trim() === ""}>{sent ? "Checking…" : "Submit Code"}</Button>
          </div>
        </FieldGroup>
      </form>
    );
  }

  if (signingIn) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border p-6 text-sm text-muted-foreground" aria-live="polite">
        <RefreshCw className="size-4 animate-spin" />
        <span>{current?.statusDetail ?? "Signing in to Instagram."}</span>
        <span className="text-xs">This updates by itself.</span>
      </div>
    );
  }

  return (
    <form onSubmit={connect} className="max-w-sm">
      <FieldGroup>
        {status === "error" && current?.statusDetail && (
          <Alert variant="destructive">
            <AlertTitle>Needs Attention</AlertTitle>
            <AlertDescription>{current.statusDetail}</AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel htmlFor="instagram-username">Instagram Username</FieldLabel>
          <Input id="instagram-username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="yourname" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="instagram-password">Password</FieldLabel>
          <Input id="instagram-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <FieldDescription>Used once to sign in, then only the session is kept, encrypted. If Instagram sends you a code, enter it here.</FieldDescription>
        </Field>
        {error && <FieldError>{error}</FieldError>}
        <div>
          <Button type="submit" disabled={busy}>{busy ? "Connecting…" : "Connect Instagram"}</Button>
        </div>
      </FieldGroup>
    </form>
  );
}
