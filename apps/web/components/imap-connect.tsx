"use client";

import { useRef, useState } from "react";
import { ELSEWHERE_TEXT, type Elsewhere, type ImapTls, type ServerSettings, type SmtpSecurity } from "@messages/mail-servers";
import { track } from "@/lib/analytics";
import { postAsUser } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Lookup = { settings: ServerSettings; hint: string | null } | { elsewhere: Elsewhere };

// The usual encryption for each port, set when the port is changed.
const IMAP_TLS: Record<number, ImapTls> = { 993: "tls", 143: "starttls" };
const SMTP_SECURITY: Record<number, SmtpSecurity> = { 465: "ssl", 587: "starttls", 25: "starttls", 2525: "starttls" };

/**
 * Connects any IMAP and SMTP mailbox with its email and password. The server settings are worked out from
 * the address; Show Server Settings shows them to change. The sign-in is checked with both servers before it is saved.
 */
export function ImapConnectForm({ defaultEmail = "", onConnected }: { defaultEmail?: string; onConnected: (result: { label: string }) => void }) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [edited, setEdited] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [elsewhere, setElsewhere] = useState<Elsewhere | null>(null);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The address the settings shown were looked up for, so the same one is not looked up twice.
  const lookedUp = useRef("");

  const lookUp = async (address: string) => {
    const key = address.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key) || key === lookedUp.current) return;
    lookedUp.current = key;
    setLooking(true);
    try {
      const found = await postAsUser<Lookup>("/api/connect/imap/settings", { email: key });
      if (lookedUp.current !== key) return; // the address changed meanwhile
      if ("elsewhere" in found) {
        setElsewhere(found.elsewhere);
        setHint(null);
        return;
      }
      setElsewhere(null);
      setHint(found.hint);
      // Settings someone has changed are theirs; a new address does not overwrite them.
      if (!edited) setSettings(found.settings);
    } catch {
      lookedUp.current = "";
    } finally {
      setLooking(false);
    }
  };

  const change = (patch: { imap?: Partial<ServerSettings["imap"]>; smtp?: Partial<ServerSettings["smtp"]>; username?: string }) => {
    if (!settings) return;
    setEdited(true);
    setSettings({ imap: { ...settings.imap, ...patch.imap }, smtp: { ...settings.smtp, ...patch.smtp }, username: patch.username ?? settings.username });
  };

  const toggleSettings = (on: boolean) => {
    setShowSettings(on);
    if (on) void lookUp(email);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await postAsUser<{ label: string }>("/api/connect/imap", { email, password, ...(edited && settings ? { settings } : {}) });
      track("account_connect", { provider: "imap", step: "app", outcome: "done" });
      onConnected(result);
    } catch (err) {
      track("account_connect", { provider: "imap", step: "app", outcome: "failed" });
      setError(err instanceof Error ? err.message : "Your email could not be connected. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="imap-email">Email</FieldLabel>
          <Input
            id="imap-email"
            type="email"
            autoComplete="username"
            placeholder="you@yourcompany.co.za"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setElsewhere(null); }}
            onBlur={() => void lookUp(email)}
            required
          />
          {elsewhere && <FieldDescription>{ELSEWHERE_TEXT[elsewhere]}</FieldDescription>}
        </Field>
        <Field>
          <FieldLabel htmlFor="imap-password">Password</FieldLabel>
          <Input id="imap-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <FieldDescription>{hint ? `${hint} ` : ""}It is stored encrypted and only used to sync and send.</FieldDescription>
        </Field>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="imap-show-settings">Show Server Settings</Label>
          <Switch id="imap-show-settings" checked={showSettings} onCheckedChange={toggleSettings} />
        </div>
        {showSettings && (
          settings ? (
            <ServerFields settings={settings} change={change} />
          ) : (
            <p className="text-sm text-muted-foreground">{looking ? "Looking Up Server Settings…" : "Enter your email to fill these in."}</p>
          )
        )}
        {error && <FieldError>{error}</FieldError>}
        <div>
          <Button type="submit" disabled={busy || !!elsewhere}>{busy ? "Checking With Your Mail Server…" : "Connect Email"}</Button>
        </div>
      </FieldGroup>
    </form>
  );
}

function ServerFields({ settings, change }: { settings: ServerSettings; change: (patch: { imap?: Partial<ServerSettings["imap"]>; smtp?: Partial<ServerSettings["smtp"]>; username?: string }) => void }) {
  const port = (value: string) => Number(value.replace(/\D/g, "").slice(0, 5)) || 0;
  return (
    <>
      <Field>
        <FieldLabel htmlFor="imap-host">Incoming Server (IMAP)</FieldLabel>
        <Input id="imap-host" autoCapitalize="none" spellCheck={false} value={settings.imap.host} onChange={(e) => change({ imap: { host: e.target.value } })} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="imap-port">Port</FieldLabel>
          <Input id="imap-port" inputMode="numeric" value={settings.imap.port || ""} onChange={(e) => { const p = port(e.target.value); change({ imap: { port: p, ...(IMAP_TLS[p] ? { tls: IMAP_TLS[p] } : {}) } }); }} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="imap-tls">Encryption</FieldLabel>
          <Select value={settings.imap.tls} onValueChange={(v) => change({ imap: { tls: v as ImapTls } })}>
            <SelectTrigger id="imap-tls" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tls">SSL</SelectItem>
              <SelectItem value="starttls">STARTTLS</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="smtp-host">Outgoing Server (SMTP)</FieldLabel>
        <Input id="smtp-host" autoCapitalize="none" spellCheck={false} value={settings.smtp.host} onChange={(e) => change({ smtp: { host: e.target.value } })} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="smtp-port">Port</FieldLabel>
          <Input id="smtp-port" inputMode="numeric" value={settings.smtp.port || ""} onChange={(e) => { const p = port(e.target.value); change({ smtp: { port: p, ...(SMTP_SECURITY[p] ? { security: SMTP_SECURITY[p] } : {}) } }); }} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="smtp-security">Encryption</FieldLabel>
          <Select value={settings.smtp.security} onValueChange={(v) => change({ smtp: { security: v as SmtpSecurity } })}>
            <SelectTrigger id="smtp-security" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ssl">SSL</SelectItem>
              <SelectItem value="starttls">STARTTLS</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="imap-username">Username</FieldLabel>
        <Input id="imap-username" autoCapitalize="none" spellCheck={false} value={settings.username} onChange={(e) => change({ username: e.target.value })} required />
        <FieldDescription>Usually your full email address.</FieldDescription>
      </Field>
    </>
  );
}
