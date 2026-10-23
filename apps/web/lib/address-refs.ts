"use client";

import { addressIndex, chatIndex, domainIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { encryptField } from "@messages/crypto";
import { companyDomain, companyNameForDomain } from "@messages/email-text/company";
import { supabase } from "./supabase";
import { open, userKeys } from "./vault";

// What the contact functions take for an address since encryption stage 2: its blind index, which the
// database matches on, and the value itself, encrypted once NEXT_PUBLIC_ENCRYPT_ADDRESSES is on. The browser
// holds the same keys as the workers, so it works these out before calling.

const encryptAddresses = process.env.NEXT_PUBLIC_ENCRYPT_ADDRESSES === "true";

export interface IdentityRef {
  kind: string;
  value: string;
  idx: string;
}

/** An address or number as stored: encrypted when addresses are, as it is otherwise. */
export async function sealAddress(value: string): Promise<string> {
  return encryptAddresses ? encryptField(await userKeys(), FIELD.address, value) : value;
}

/** Each address or number with its index, ready for create_contact. */
export async function identityRefs(items: { kind: string; value: string }[]): Promise<IdentityRef[]> {
  const keys = await userKeys();
  return Promise.all(items.map(async (i) => ({ kind: i.kind, value: await sealAddress(i.value), idx: await addressIndex(keys, i.value) })));
}

/** Every address on your accounts, for leaving your own domains out of companies. */
async function ownAddresses(): Promise<string[]> {
  const { data } = await supabase.from("accounts").select("address, send_addresses");
  const values = (data ?? []).flatMap((a) => [a.address, ...(a.send_addresses ?? [])]);
  return (await Promise.all(values.map((v) => open(FIELD.address, v)))).filter((v): v is string => !!v);
}

/** The company an email address belongs to, as organization_for_index takes it, or null. */
export async function companyRef(email: string | undefined): Promise<{ index: string; domain: string; name: string } | null> {
  if (!email) return null;
  const domain = companyDomain(email, await ownAddresses());
  if (!domain) return null;
  const keys = await userKeys();
  return {
    index: await domainIndex(keys, domain),
    domain: encryptAddresses ? await encryptField(keys, FIELD.domain, domain) : domain,
    name: companyNameForDomain(domain),
  };
}

/** The index of the one-to-one WhatsApp chat with a number ("+27...") or privacy ID ("...@lid"). */
export async function chatIndexFor(value: string): Promise<string | null> {
  const keys = await userKeys();
  if (/^\+[0-9]{7,15}$/.test(value)) return chatIndex(keys, `${value.slice(1)}@s.whatsapp.net`);
  if (/^[0-9]+@lid$/.test(value)) return chatIndex(keys, value);
  return null;
}
