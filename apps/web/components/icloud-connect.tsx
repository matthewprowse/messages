"use client";

import { useState } from "react";
import { track } from "@/lib/analytics";
import { postAsUser } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const APPLE_PASSWORDS = "https://account.apple.com/account/manage/section/security";

/** Connects iCloud+ Mail, and iCloud Calendar with the same sign-in. The password is checked with iCloud before it is saved. */
export function ICloudConnectForm({ defaultEmail = "", onConnected }: { defaultEmail?: string; onConnected: (result: { calendar: boolean }) => void }) {
  const ownDomain = defaultEmail !== "" && !/@(icloud|me|mac)\.com$/i.test(defaultEmail);
  const [username, setUsername] = useState(ownDomain ? "" : defaultEmail);
  const [address, setAddress] = useState(ownDomain ? defaultEmail : "");
  const [password, setPassword] = useState("");
  const [calendar, setCalendar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await postAsUser<{ calendar: boolean }>("/api/connect/icloud", { username, password, address, calendar });
      track("account_connect", { provider: "icloud", step: "app", outcome: "done" });
      onConnected(result);
    } catch (err) {
      track("account_connect", { provider: "icloud", step: "app", outcome: "failed" });
      setError(err instanceof Error ? err.message : "iCloud could not be connected. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="icloud-username">iCloud Email</FieldLabel>
          <Input id="icloud-username" type="email" autoComplete="username" placeholder="name@icloud.com" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="icloud-password">App-Specific Password</FieldLabel>
          <Input id="icloud-password" type="password" autoComplete="off" placeholder="xxxx-xxxx-xxxx-xxxx" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <FieldDescription>
            Make one at{" "}
            <a href={APPLE_PASSWORDS} target="_blank" rel="noreferrer" className="underline underline-offset-2">account.apple.com</a>
            , under Sign-In and Security, then App-Specific Passwords. It is stored encrypted and only used to sync.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="icloud-address">Address People Email You At</FieldLabel>
          <Input id="icloud-address" type="email" placeholder="Same as above" value={address} onChange={(e) => setAddress(e.target.value)} />
          <FieldDescription>Only if you use your own domain with iCloud+.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="icloud-calendar" checked={calendar} onCheckedChange={(v) => setCalendar(v === true)} />
          <FieldLabel htmlFor="icloud-calendar" className="font-normal">Also Connect iCloud Calendar</FieldLabel>
        </Field>
        {error && <FieldError>{error}</FieldError>}
        <div>
          <Button type="submit" disabled={busy}>{busy ? "Checking With iCloud…" : "Connect iCloud"}</Button>
        </div>
      </FieldGroup>
    </form>
  );
}
