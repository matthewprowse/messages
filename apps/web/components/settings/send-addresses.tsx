"use client";

// Settings, Accounts, Sending, Send From: the addresses each email account can send from, which the reply box and New Email offer.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import type { Account } from "@/lib/types";
import { isEmail, sendAddressesOf } from "@/lib/send-from";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsBody, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

/** iCloud and other IMAP mailboxes: the server cannot say which addresses you send from, so you list them. */
function ListedAddresses({ account }: { account: Account }) {
  const { saveSendAddresses, notify } = useApp();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = `address-error-${account.id}`;
  const own = account.detail.toLowerCase();
  // The account's own address can always send, so it is shown but cannot be removed.
  const extra = sendAddressesOf(account).filter((a) => a !== own);
  // The own address is always saved too, so the list is never empty: the worker refills an empty list.
  const save = (list: string[]) => saveSendAddresses(account.id, [own, ...list]);

  const add = async () => {
    const address = value.trim().toLowerCase();
    if (!isEmail(address)) return setError("Enter a full email address.");
    if (address === own || extra.includes(address)) return setError("That address is already on the list.");
    setError(null);
    if (await save([...extra, address])) {
      setValue("");
      notify("Address added");
    }
  };

  return (
    <>
      <SettingsRows>
        <SettingsRow title={own} />
        {extra.map((a) => (
          <SettingsRow key={a} title={a}>
            <Button variant="ghost" size="icon" aria-label={`Remove ${a}`} onClick={async () => { if (await save(extra.filter((x) => x !== a))) notify("Address removed", () => void save(extra)); }}><Trash2 /></Button>
          </SettingsRow>
        ))}
      </SettingsRows>
      <SettingsBody className="gap-2">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} placeholder="you@yourdomain.com" aria-invalid={!!error} aria-describedby={error ? errorId : undefined} aria-label="Address to Add" className="flex-1" />
          <Button variant="secondary" type="submit" disabled={!value.trim()}>Add</Button>
        </form>
        {error && <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p>}
      </SettingsBody>
    </>
  );
}

function GmailAddresses({ account }: { account: Account }) {
  return (
    <SettingsRows>
      {sendAddressesOf(account).map((a) => <SettingsRow key={a} title={a} />)}
    </SettingsRows>
  );
}

/** The Send From group of the Sending card: per mailbox, the addresses it can send from. Nothing when there is no mailbox. */
export function SendAddressesSection() {
  const { accounts } = useApp();
  const email = accounts.filter((a) => (a.provider === "icloud" || a.provider === "gmail" || a.provider === "imap") && a.status !== "disconnected");
  if (email.length === 0) return null;
  return (
    <SettingsSection id="send-from" level={3} title="Send From">
      {email.map((a) => (
        <SettingsSection key={a.id} level={4} title={a.label}>
          {a.provider === "gmail" ? <GmailAddresses account={a} /> : <ListedAddresses account={a} />}
        </SettingsSection>
      ))}
    </SettingsSection>
  );
}
