"use client";

// Connects LinkedIn by email and password in Settings, and handles the code or app approval LinkedIn may ask for.

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
import { Textarea } from "@/components/ui/textarea";

type Step = { kind: "code" | "app"; method: "email" | "sms" | "totp" | null; canTryAnotherWay: boolean; attempts: number; rejected: boolean } | null;

const STEP_POLL_MS = 3_000;
const WAITING_MAX_MS = 15_000; // how long to show "signing in" before the account's own status says so

/**
 * Connects LinkedIn with an email and password. The LinkedIn connector signs in and, when LinkedIn asks for a
 * code or for the sign-in to be approved in its app, says so here; the code typed is handed back to it. The
 * account's status comes live from the store. When the session ends, the same form is shown again with why.
 */
export function LinkedInConnect() {
  const { accounts } = useApp();
  const account = accounts.find((a) => a.provider === "linkedin");
  const [accountId, setAccountId] = useState<string | null>(null);
  const id = accountId ?? account?.id ?? null;
  const current = accounts.find((a) => a.id === id) ?? account;
  const status = current?.status;
  // Just sent: signing in, until the account's own status says so too (or a little while has gone by).
  const [waiting, setWaiting] = useState(false);
  useEffect(() => { if (status === "connecting") setWaiting(false); }, [status]);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setWaiting(false), WAITING_MAX_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  const signingIn = status === "connecting" || waiting;
  const linked = status === "connected" || status === "syncing";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [proxy, setProxy] = useState<string | null>(null); // null: not edited, so the account keeps the one it has
  const [advanced, setAdvanced] = useState(false);
  const [cookies, setCookies] = useState(false);
  const [paste, setPaste] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While signing in, what LinkedIn is asking for. Checked every few seconds.
  const checkStep = useCallback(async () => {
    if (!id) return;
    try {
      const result = await postAsUser<{ step: Step }>("/api/connect/linkedin/code", { accountId: id });
      setStep((prev) => {
        if (prev?.attempts !== result.step?.attempts || prev?.kind !== result.step?.kind) {
          setSent(false);
          setCode("");
        }
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

  const connect = async (body: Record<string, string>, how: "password" | "cookies") => {
    setBusy(true);
    setError(null);
    try {
      const result = await postAsUser<{ accountId: string }>("/api/connect/linkedin", body);
      setAccountId(result.accountId);
      setWaiting(true);
      setPassword("");
      setPaste("");
      track("account_connect", { provider: "linkedin", step: "app", outcome: "done" });
    } catch (err) {
      track("account_connect", { provider: "linkedin", step: "app", outcome: "failed" });
      setError(err instanceof Error ? err.message : how === "password" ? "LinkedIn could not be connected. Try again." : "The cookies could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const signIn = (e: React.FormEvent) => {
    e.preventDefault();
    void connect({ email, password, ...(proxy !== null ? { proxy } : {}) }, "password");
  };

  const answer = async (body: { code: string } | { tryAnotherWay: true }) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await postAsUser("/api/connect/linkedin/code", { accountId: id, ...body });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (linked) {
    return (
      <SettingsRows>
        <SettingsRow
          title={<>LinkedIn <Badge variant="secondary">{status === "syncing" ? "Importing" : "Connected"}</Badge></>}
          description={status === "syncing" ? "Your recent LinkedIn conversations are importing." : "New messages appear in the Inbox as they arrive."}
        />
      </SettingsRows>
    );
  }

  if (signingIn && step?.kind === "code") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); void answer({ code }); }} className="max-w-sm space-y-4 rounded-lg border p-4">
        <SettingsHeading title="Enter the 6-Digit Code" description={current?.statusDetail ?? "Enter the 6-digit code LinkedIn sent you."} />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="linkedin-code">{step.method === "totp" ? "Authenticator Code" : "Verification Code"}</FieldLabel>
            <Input id="linkedin-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} disabled={sent} required />
            <FieldDescription>{sent ? "Checking the code with LinkedIn." : "The code is only used for this sign-in and is not kept."}</FieldDescription>
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <div>
            <Button type="submit" disabled={busy || sent || code.replace(/\D/g, "").length !== 6}>{sent ? "Checking…" : "Submit Code"}</Button>
          </div>
        </FieldGroup>
      </form>
    );
  }

  if (signingIn && step?.kind === "app") {
    return (
      <div className="max-w-sm space-y-4 rounded-lg border p-4" aria-live="polite">
        <SettingsHeading title="Approve in the LinkedIn App" description={current?.statusDetail ?? "Approve the sign-in in the LinkedIn app on your phone."} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          <span>{sent ? "Asking LinkedIn for another way." : "Waiting for your approval."}</span>
        </div>
        {error && <FieldError>{error}</FieldError>}
        {step.canTryAnotherWay && (
          <div>
            <Button variant="secondary" disabled={busy || sent} onClick={() => void answer({ tryAnotherWay: true })}>Try Another Way</Button>
          </div>
        )}
      </div>
    );
  }

  if (signingIn) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border p-6 text-sm text-muted-foreground" aria-live="polite">
        <RefreshCw className="size-4 animate-spin" />
        <span>{current?.statusDetail ?? "Signing in to LinkedIn."}</span>
        <span className="text-xs">This can take a minute. It updates by itself.</span>
      </div>
    );
  }

  return (
    <div className="max-w-sm space-y-4">
      {status === "error" && current?.statusDetail && (
        <Alert variant="destructive">
          <AlertTitle>Needs Attention</AlertTitle>
          <AlertDescription>{current.statusDetail}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={signIn}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="linkedin-email">LinkedIn Email</FieldLabel>
            <Input id="linkedin-email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="linkedin-password">Password</FieldLabel>
            <Input id="linkedin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <FieldDescription>Used once to sign in, then only the session is kept, encrypted. If LinkedIn asks for a code or for you to approve the sign-in in its app, you do it here.</FieldDescription>
          </Field>
          {advanced && (
            <Field>
              <FieldLabel htmlFor="linkedin-proxy">Proxy (Optional)</FieldLabel>
              <Input id="linkedin-proxy" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="http://user:password@proxy.example.com:8080" value={proxy ?? ""} onChange={(e) => setProxy(e.target.value)} />
              <FieldDescription>Only if you have been given one. LinkedIn sees this address instead of Konva&apos;s.</FieldDescription>
            </Field>
          )}
          {error && !cookies && <FieldError>{error}</FieldError>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || !email.trim() || !password}>{busy ? "Connecting…" : status === "error" ? "Reconnect LinkedIn" : "Sign In to LinkedIn"}</Button>
            {!advanced && <Button type="button" variant="ghost" onClick={() => setAdvanced(true)}>Advanced</Button>}
          </div>
        </FieldGroup>
      </form>

      <div>
        <Button type="button" variant="link" className="h-auto p-0 text-sm" aria-expanded={cookies} onClick={() => setCookies((v) => !v)}>Sign In With Cookies Instead</Button>
        {cookies && (
          <form className="mt-3" onSubmit={(e) => { e.preventDefault(); void connect({ curl: paste, ...(proxy !== null ? { proxy } : {}) }, "cookies"); }}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="linkedin-curl">Copied Request</FieldLabel>
                <Textarea id="linkedin-curl" rows={5} autoComplete="off" spellCheck={false} className="font-mono text-xs" placeholder="curl 'https://www.linkedin.com/…' -H 'cookie: …'" value={paste} onChange={(e) => setPaste(e.target.value)} required />
                <FieldDescription>
                  Sign in at linkedin.com in a private browser window, open the developer tools and its Network tab, go to Messaging, then copy
                  any request to www.linkedin.com as cURL and paste it here. Only the cookies and LinkedIn&apos;s own headers are kept. A session from
                  cookies can end sooner than one from signing in here.
                </FieldDescription>
              </Field>
              {error && <FieldError>{error}</FieldError>}
              <div>
                <Button type="submit" disabled={busy || !paste.trim()}>{busy ? "Saving…" : "Connect With Cookies"}</Button>
              </div>
            </FieldGroup>
          </form>
        )}
      </div>
    </div>
  );
}
