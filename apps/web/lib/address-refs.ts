"use client";

// What the contact functions take for an address since encryption stage 2: its blind index, which the
// database matches on, and the value itself, encrypted once NEXT_PUBLIC_ENCRYPT_ADDRESSES is on. The browser
// holds the same keys as the workers, so it works these out before calling.

import { flagOn } from "@messages/crypto/flags";
import { addressIndex, chatIndex, domainIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import type { Place } from "@messages/crypto";
import { companyDomain, companyNameForDomain } from "@messages/email-text/company";
import { supabase } from "./supabase";
import { open, seal, sealWith, userKeys } from "./vault";

const encryptAddresses = flagOn(process.env.NEXT_PUBLIC_ENCRYPT_ADDRESSES);

export interface IdentityRef {
  kind: string;
  value: string;
  idx: string;
}

/** An address or number as stored at `where`: encrypted when addresses are, as it is otherwise. */
export async function sealAddress(value: string, where?: Place): Promise<string> {
  return encryptAddresses ? sealWith(await userKeys(), FIELD.address, value, where) : value;
}

/** Each address or number with its index, ready for create_contact. */
export async function identityRefs(items: { kind: string; value: string }[]): Promise<IdentityRef[]> {
  const keys = await userKeys();
  return Promise.all(items.map(async (i) => ({
    kind: i.kind,
    value: encryptAddresses ? await sealWith(keys, FIELD.address, i.value, { place: "contact_identities.value" }) : i.value,
    idx: await addressIndex(keys, i.value),
  })));
}

// Your own addresses change only when an account is linked or edited, so they are read and opened once per
// signed-in user and reused for a few minutes. Without this every companyRef call re-read and re-decrypted
// every account.
const OWN_ADDRESSES_TTL = 10 * 60_000;
let ownCache: { user: string | null; at: number; value: Promise<string[]> } | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  if (ownCache && ownCache.user !== (session?.user.id ?? null)) ownCache = null;
});

async function readOwnAddresses(): Promise<string[]> {
  const { data, error } = await supabase.from("accounts").select("address, send_addresses");
  if (error) throw new Error(`Load accounts failed (${error.code})`);
  const values = (data ?? []).flatMap((a) => [a.address, ...(a.send_addresses ?? [])]);
  return (await Promise.all(values.map((v) => open(FIELD.address, v)))).filter((v): v is string => !!v);
}

/** Every address on your accounts, for leaving your own domains out of companies. */
async function ownAddresses(): Promise<string[]> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user.id ?? null;
  if (ownCache && ownCache.user === user && Date.now() - ownCache.at < OWN_ADDRESSES_TTL) return ownCache.value;
  const entry = { user, at: Date.now(), value: readOwnAddresses() };
  ownCache = entry;
  // A failed read is not kept: the next call tries again, and for now your addresses read as none, as before.
  const read = entry.value.catch(() => {
    if (ownCache === entry) ownCache = null;
    return [] as string[];
  });
  entry.value = read;
  return read;
}

/** The company an email address belongs to, as organization_for_index takes it (domain and name sealed), or null. */
export async function companyRef(email: string | undefined): Promise<{ index: string; domain: string; name: string } | null> {
  if (!email) return null;
  const domain = companyDomain(email, await ownAddresses());
  if (!domain) return null;
  const keys = await userKeys();
  return {
    index: await domainIndex(keys, domain),
    domain: encryptAddresses ? await sealWith(keys, FIELD.domain, domain, { place: "organizations.domain" }) : domain,
    // Sealed like every company name: the database stores it as given and never reads it.
    name: await seal(FIELD.name, companyNameForDomain(domain), { place: "organizations.name" }),
  };
}

/** The index of the one-to-one WhatsApp chat with a number ("+27...") or privacy ID ("...@lid"). */
export async function chatIndexFor(value: string): Promise<string | null> {
  const keys = await userKeys();
  if (/^\+[0-9]{7,15}$/.test(value)) return chatIndex(keys, `${value.slice(1)}@s.whatsapp.net`);
  if (/^[0-9]+@lid$/.test(value)) return chatIndex(keys, value);
  return null;
}
