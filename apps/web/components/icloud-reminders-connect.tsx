"use client";

// Connects iCloud Reminders in Settings. Apple's sign-in steps (code or go-ahead) are handled here as the connector asks for them.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { track } from "@/lib/analytics";
import { postAsUser } from "@/lib/onboarding";
import { useApp } from "@/lib/store";
import { SettingsHeading, SettingsRow, SettingsRows } from "@/components/settings/primitives";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Step = { step: "code" | "two_factor"; method: "email" | "sms" | "app" | null; attempts: number } | null;

const STEP_POLL_MS = 3_000;

/**
 * Connects iCloud Reminders with an Apple ID and password. The iCloud Reminders connector signs in to iCloud
 * for the person and says here what Apple asks for: the 6-digit code (from a device, or by text), or, with
 * Advanced Data Protection, a go-ahead once Access iCloud Data on the Web is on. What is typed is handed back to
 * it. The account's status comes live from the store; when Apple ends the session it shows Reconnect, which
 * brings the person back here.
 */
export function ICloudRemindersConnect() {
  const { accounts } = useApp();
  const account = accounts.find((a) => a.provider === "icloud_reminders");
  const [accountId, setAccountId] = useState<string | null>(null);
  const id = accountId ?? account?.id ?? null;
  const current = accounts.find((a) => a.id === id) ?? account;
  const status = current?.status;
  // Just connected: signing in, until the account's own status says so too.
  const [waiting, setWaiting] = useState(false);
  useEffect(() => { if (status === "connecting") setWaiting(false); }, [status]);
  const signingIn = status === "connecting" || waiting;
  const linked = status === "connected" || status === "syncing";

  const [appleId, setAppleId] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [again, setAgain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While signing in, what iCloud is asking for. Checked every few seconds.
  const checkStep = useCallback(async () => {
    if (!id) return;
    try {
      const result = await postAsUser<{ step: Step }>("/api/connect/icloud-reminders/code", { accountId: id });
      setStep((prev) => {
        if (prev?.attempts !== result.step?.attempts || prev?.step !== result.step?.step || prev?.method !== result.step?.method) setSent(false);
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
      const result = await postAsUser<{ accountId: string }>("/api/connect/icloud-reminders", { appleId, password });
      setAccountId(result.accountId);
      setWaiting(true);
      setAgain(false);
      setPassword("");
      track("account_connect", { provider: "icloud_reminders", step: "app", outcome: "done" });
    } catch (err) {
      track("account_connect", { provider: "icloud_reminders", step: "app", outcome: "failed" });
      setError(err instanceof Error ? err.message : "iCloud Reminders could not be connected. Try again.");
    } finally {
      setBusy(false);
    }
  };

  /** A code, or one of the two buttons: Send a Text Instead, and Continue once web access is on. */
  const answer = async (body: { code: string } | { action: "sms" | "continue" }) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await postAsUser("/api/connect/icloud-reminders/code", { accountId: id, ...body });
      setCode("");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    void answer({ code });
  };

  if (linked && !again) {
    return (
      <SettingsRows>
        <SettingsRow
          title={<>iCloud Reminders <Badge variant="secondary">{status === "syncing" ? "Importing" : "Connected"}</Badge></>}
          description={status === "syncing" ? "Your reminders are importing." : "Your reminders appear in Calendar on the day they are due. Changes reach Konva within a few minutes."}
        >
          <Button variant="secondary" onClick={() => setAgain(true)}>Sign In Again</Button>
        </SettingsRow>
      </SettingsRows>
    );
  }

  if (signingIn && step?.step === "code") {
    return (
      <div className="space-y-4 rounded-lg border p-4">
        <SettingsHeading title="Approve on Your Apple Device" description={current?.statusDetail ?? "Turn on Access iCloud Data on the Web on your iPhone, then continue."} />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>On your iPhone, open Settings, tap your name, then iCloud.</li>
          <li>Turn on Access iCloud Data on the Web.</li>
          <li>Choose Continue below, then approve the prompt that appears on your device.</li>
        </ol>
        {error && <FieldError>{error}</FieldError>}
        <div>
          <Button onClick={() => void answer({ action: "continue" })} disabled={busy || sent}>{sent ? "Waiting for Approval…" : "Continue"}</Button>
        </div>
      </div>
    );
  }

  if (signingIn && step?.step === "two_factor") {
    const text = step.method === "sms";
    return (
      <form onSubmit={submitCode} className="space-y-4 rounded-lg border p-4">
        <SettingsHeading
          title={text ? "Enter the Code Apple Texted You" : "Enter the Code From Your Apple Device"}
          description={current?.statusDetail ?? "Enter the 6-digit code from Apple."}
        />
        <FieldGroup>
          <Field className="max-w-xs">
            <FieldLabel htmlFor="icloud-reminders-code">Verification Code</FieldLabel>
            <Input id="icloud-reminders-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} disabled={sent} required />
            <FieldDescription>{sent ? "Checking the code with Apple." : "The code is only used for this sign-in and is not kept."}</FieldDescription>
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || sent || code.trim() === ""}>{sent ? "Checking…" : "Submit Code"}</Button>
            {!text && <Button type="button" variant="secondary" onClick={() => void answer({ action: "sms" })} disabled={busy || sent}>Send a Text Instead</Button>}
          </div>
        </FieldGroup>
      </form>
    );
  }

  if (signingIn) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border p-6 text-sm text-muted-foreground" aria-live="polite">
        <RefreshCw className="size-4 animate-spin" />
        <span>{current?.statusDetail ?? "Signing in to iCloud."}</span>
        <span className="text-xs">This can take a minute and updates by itself.</span>
      </div>
    );
  }

  const reconnecting = status === "error" || status === "disconnected" || again;
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
          <FieldLabel htmlFor="icloud-reminders-apple-id">Apple ID</FieldLabel>
          <Input id="icloud-reminders-apple-id" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="name@icloud.com" value={appleId} onChange={(e) => setAppleId(e.target.value)} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="icloud-reminders-password">Apple ID Password</FieldLabel>
          <Input id="icloud-reminders-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <FieldDescription>
            Konva signs in to iCloud on your behalf, and only reads and updates your Reminders. Your password is used once to sign in and is not kept.
            You may need to sign in again about once a month.
          </FieldDescription>
        </Field>
        {error && <FieldError>{error}</FieldError>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>{busy ? "Connecting…" : reconnecting ? "Reconnect iCloud Reminders" : "Connect iCloud Reminders"}</Button>
          {again && <Button type="button" variant="ghost" onClick={() => setAgain(false)}>Cancel</Button>}
        </div>
      </FieldGroup>
    </form>
  );
}
