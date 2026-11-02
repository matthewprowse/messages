"use client";

// Connect iCloud with one Apple ID sign-in, in Settings and onboarding: tick Mail, Calendar and Reminders, enter the code
// from an Apple device, and Konva makes the app-specific password itself. Reminders then carries on in its own section.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { track } from "@/lib/analytics";
import { connectedMessage, isICloudAddress, type ICloudService, type SetupState } from "@/lib/icloud-signin";
import { postAsUser } from "@/lib/onboarding";
import { SettingsHeading } from "@/components/settings/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const STEP_POLL_MS = 3_000;
const SERVICES: { key: ICloudService; label: string }[] = [
  { key: "mail", label: "Mail" },
  { key: "calendar", label: "Calendar" },
  { key: "reminders", label: "Reminders" },
];

/** What was connected, and the line to show for it. */
export type ICloudConnected = { mail: boolean; calendar: boolean; reminders: boolean; message: string };

/**
 * The Apple ID form, then whatever Apple asks for while the iCloud connector signs in. For Mail or Calendar it makes an
 * app-specific password labelled "Konva" (it shows in the person's Apple Account and can be removed there); the
 * session that made it is not kept. onUsePassword offers the paste-a-password form for an Apple ID that cannot do this.
 */
export function ICloudSignIn({ defaultEmail = "", onConnected, onUsePassword }: { defaultEmail?: string; onConnected: (result: ICloudConnected) => void; onUsePassword?: () => void }) {
  const [appleId, setAppleId] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [mailAddress, setMailAddress] = useState("");
  const [address, setAddress] = useState("");
  const [ticked, setTicked] = useState<Record<ICloudService, boolean>>({ mail: true, calendar: true, reminders: true });
  const [setupId, setSetupId] = useState<string | null>(null);
  const [state, setState] = useState<SetupState | null>(null);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsMailAddress = ticked.mail && appleId.trim() !== "" && !isICloudAddress(appleId);
  const wantsPassword = ticked.mail || ticked.calendar;

  const check = useCallback(async () => {
    if (!setupId) return;
    try {
      const next = await postAsUser<SetupState>("/api/connect/icloud-signin/step", { setupId });
      setState((prev) => {
        if (prev?.attempts !== next.attempts || prev?.method !== next.method || prev?.status !== next.status) setSent(false);
        return next;
      });
      if (next.status === "done" && next.connected) {
        setSetupId(null);
        track("account_connect", { provider: "icloud", step: "sign_in", outcome: "done" });
        const done = { mail: next.connected.mail, calendar: next.connected.calendar, reminders: next.connected.remindersAccountId !== null };
        onConnected({ ...done, message: connectedMessage(done, ticked) });
      } else if (next.status === "failed") {
        setSetupId(null);
        setError(next.error ?? "iCloud could not be connected. Try again.");
        track("account_connect", { provider: "icloud", step: "sign_in", outcome: "failed" });
      }
    } catch {
      // Tried again on the next tick.
    }
  }, [setupId, onConnected, ticked]);

  useEffect(() => {
    if (!setupId) return;
    void check();
    const t = setInterval(() => void check(), STEP_POLL_MS);
    return () => clearInterval(t);
  }, [setupId, check]);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setState(null);
    try {
      const result = await postAsUser<{ setupId?: string; remindersAccountId?: string }>("/api/connect/icloud-signin", { appleId, password, mailAddress, address, ...ticked });
      setPassword("");
      track("account_connect", { provider: "icloud", step: "app", outcome: "done" });
      if (result.setupId) setSetupId(result.setupId);
      else onConnected({ mail: false, calendar: false, reminders: true, message: connectedMessage({ mail: false, calendar: false, reminders: true }) });
    } catch (err) {
      track("account_connect", { provider: "icloud", step: "app", outcome: "failed" });
      setError(err instanceof Error ? err.message : "iCloud could not be connected. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const answer = async (body: { code: string } | { action: "sms" }) => {
    if (!setupId) return;
    setBusy(true);
    setError(null);
    try {
      await postAsUser("/api/connect/icloud-signin/step", { setupId, ...body });
      setCode("");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (setupId && state?.status === "code") {
    const text = state.method === "sms";
    return (
      <form onSubmit={(e) => { e.preventDefault(); void answer({ code }); }} className="space-y-4 rounded-lg border p-4">
        <SettingsHeading
          title={text ? "Enter the Code Apple Texted You" : "Enter the Code From Your Apple Device"}
          description={state.detail ?? "Enter the 6-digit code from Apple."}
        />
        <FieldGroup>
          <Field className="max-w-xs">
            <FieldLabel htmlFor="icloud-signin-code">Verification Code</FieldLabel>
            <Input id="icloud-signin-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} disabled={sent} required />
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

  if (setupId) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border p-6 text-sm text-muted-foreground" aria-live="polite">
        <RefreshCw className="size-4 animate-spin" />
        <span>{state?.detail ?? "Signing in to your Apple Account."}</span>
        <span className="text-xs">This can take a minute and updates by itself.</span>
      </div>
    );
  }

  return (
    <form onSubmit={connect}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="icloud-signin-apple-id">Apple ID</FieldLabel>
          <Input id="icloud-signin-apple-id" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="name@icloud.com" value={appleId} onChange={(e) => setAppleId(e.target.value)} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="icloud-signin-password">Apple ID Password</FieldLabel>
          <Input id="icloud-signin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <FieldDescription>
            {wantsPassword
              ? "Konva signs in once and makes an app-specific password called Konva for Mail and Calendar. You can remove it at account.apple.com at any time."
              : "Konva signs in to iCloud on your behalf and only reads and updates your Reminders."}
            {ticked.reminders ? " Reminders keeps its own sign-in, which may need renewing about once a month." : " Your Apple ID password is not kept."}
          </FieldDescription>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Connect</FieldLegend>
          {SERVICES.map(({ key, label }) => (
            <Field key={key} orientation="horizontal">
              <Checkbox id={`icloud-signin-${key}`} checked={ticked[key]} onCheckedChange={(v) => setTicked((t) => ({ ...t, [key]: v === true }))} />
              <FieldLabel htmlFor={`icloud-signin-${key}`} className="font-normal">{label}</FieldLabel>
            </Field>
          ))}
        </FieldSet>
        {needsMailAddress && (
          <Field>
            <FieldLabel htmlFor="icloud-signin-mail">iCloud Mail Address</FieldLabel>
            <Input id="icloud-signin-mail" type="email" autoCapitalize="none" spellCheck={false} placeholder="name@icloud.com" value={mailAddress} onChange={(e) => setMailAddress(e.target.value)} required />
            <FieldDescription>Your Apple ID is not an iCloud address, so enter the one iCloud Mail uses.</FieldDescription>
          </Field>
        )}
        {ticked.mail && (
          <Field>
            <FieldLabel htmlFor="icloud-signin-address">Address People Email You At</FieldLabel>
            <Input id="icloud-signin-address" type="email" placeholder="Same as your iCloud Mail" value={address} onChange={(e) => setAddress(e.target.value)} />
            <FieldDescription>Only if you use your own domain with iCloud+.</FieldDescription>
          </Field>
        )}
        {error && <FieldError>{error}</FieldError>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !(ticked.mail || ticked.calendar || ticked.reminders)}>{busy ? "Connecting…" : "Connect iCloud"}</Button>
          {onUsePassword && <Button type="button" variant="ghost" onClick={onUsePassword}>Use an App-Specific Password Instead</Button>}
        </div>
      </FieldGroup>
    </form>
  );
}
