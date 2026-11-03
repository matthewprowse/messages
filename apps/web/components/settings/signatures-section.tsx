"use client";

// Settings, Accounts, Sending, Signatures: a signature for every address an email account can send from, and which address is written
// as by default. The signature is added below the text of an email when it is sent, never to a chat (lib/signature.ts).

import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import type { Account } from "@/lib/types";
import { sendAddressesOf } from "@/lib/send-from";
import { MAX_SIGNATURE, signatureFor, withDefaultFrom, withSignature } from "@/lib/composer-settings";
import { useAccountComposer } from "@/lib/use-account-composer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

/** One address's signature box, saved with its own button so a half-typed signature is never stored. */
function SignatureEditor({ account, address }: { account: Account; address: string }) {
  const { notify } = useApp();
  const { of, save } = useAccountComposer();
  const stored = signatureFor(of(account.id), address);
  const [value, setValue] = useState(stored);
  const [saving, setSaving] = useState(false);
  // A save from elsewhere (another tab loading in) replaces what is shown only while nothing is being typed.
  useEffect(() => { setValue((v) => (v === "" || v === stored ? stored : v)); }, [stored]);
  const dirty = value.trim() !== stored.trim();
  const submit = async () => {
    setSaving(true);
    const ok = await save(account.id, withSignature(of(account.id), address, value));
    setSaving(false);
    notify(ok ? (value.trim() ? "Signature saved" : "Signature removed") : "Could not save the signature. Try again.");
  };
  return (
    <div className="grid gap-2 p-3">
      <label htmlFor={`signature-${account.id}-${address}`} className="text-sm font-medium">{address}</label>
      <Textarea id={`signature-${account.id}-${address}`} rows={4} maxLength={MAX_SIGNATURE} value={value} onChange={(e) => setValue(e.target.value)} placeholder={"Matthew Prowse\nKonva\n+27 82 000 0000"} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!dirty || saving} onClick={() => setValue(stored)}>Reset</Button>
        <Button variant="secondary" disabled={!dirty || saving} onClick={submit}>Save</Button>
      </div>
    </div>
  );
}

/** The address new emails and replies are written as when nothing else decides, for an account with more than one. */
function DefaultFrom({ account, addresses }: { account: Account; addresses: string[] }) {
  const { notify } = useApp();
  const { of, save } = useAccountComposer();
  const current = of(account.id).defaultFrom;
  const value = current && addresses.includes(current) ? current : addresses[0];
  return (
    <SettingsRows>
      <SettingsRow title="Default Send From">
        <Select value={value} onValueChange={async (v) => { if (!(await save(account.id, withDefaultFrom(of(account.id), v === addresses[0] ? undefined : v)))) notify("Could not save. Try again."); }}>
          <SelectTrigger className="w-64 max-w-full" aria-label={`Default Send From for ${account.label}`}><SelectValue /></SelectTrigger>
          <SelectContent>{addresses.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
      </SettingsRow>
    </SettingsRows>
  );
}

/** The Signatures group of the Sending card: a box for each send address of each mailbox, and a default where there is a choice. */
export function SignaturesSection() {
  const { accounts } = useApp();
  const email = accounts.filter((a) => (a.provider === "icloud" || a.provider === "gmail" || a.provider === "outlook" || a.provider === "imap") && a.status !== "disconnected");
  if (email.length === 0) return null;
  return (
    <SettingsSection id="signatures" level={3} title="Signatures">
      {email.map((a) => {
        const addresses = sendAddressesOf(a);
        return (
          <SettingsSection key={a.id} level={4} title={a.label}>
            {addresses.length > 1 && <DefaultFrom account={a} addresses={addresses} />}
            {addresses.map((address) => <SignatureEditor key={address} account={a} address={address} />)}
          </SettingsSection>
        );
      })}
    </SettingsSection>
  );
}
