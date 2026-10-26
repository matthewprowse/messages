"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import type { Account } from "@/lib/types";
import { isEmail, sendAddressesOf } from "@/lib/send-from";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";

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
        <SettingsRow title={own} description="Account Address" />
        {extra.map((a) => (
          <SettingsRow key={a} title={a}>
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${a}`} onClick={async () => { if (await save(extra.filter((x) => x !== a))) notify("Address removed", () => void save(extra)); }}><Trash2 /></Button>
          </SettingsRow>
        ))}
      </SettingsRows>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Input value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} placeholder="you@yourdomain.com" aria-invalid={!!error} aria-describedby={error ? errorId : undefined} aria-label="Address to Add" className="flex-1" />
        <Button type="submit" disabled={!value.trim()}>Add</Button>
      </form>
      {error && <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p>}
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

/** The addresses each email account can send from, picked in the reply box and in New Email. */
export function SendAddressesSection() {
  const { accounts } = useApp();
  const email = accounts.filter((a) => (a.provider === "icloud" || a.provider === "gmail" || a.provider === "imap") && a.status !== "disconnected");
  if (email.length === 0) return null;
  return (
    <SettingsSection id="send-addresses" title="Addresses You Send From" description="Choose between these when you reply or start a new email.">
      {email.map((a) => (
        <SettingsSection
          key={a.id}
          level={3}
          title={a.label}
          description={a.provider === "icloud"
            ? "Each address must already be set up as an iCloud+ custom domain address."
            : a.provider === "imap"
              ? "Each address must be one your mail server lets you send from, like an alias of this mailbox."
              : "From Gmail Settings, under Send Mail As. Changes there appear here on the next sync."}
        >
          {a.provider === "gmail" ? <GmailAddresses account={a} /> : <ListedAddresses account={a} />}
        </SettingsSection>
      ))}
    </SettingsSection>
  );
}
