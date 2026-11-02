// Maps a contact row and its identities to the app's Contact. Pure: no network, no database.

import type { Contact } from "../types";
import { companyLogo, isCompanySender, logoAvatar } from "../people";
import type { ContactRow, IdentityRow } from "./columns";

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function mapContact(row: ContactRow, identities: IdentityRow[]): Contact {
  const emails = identities.filter((i) => i.kind === "email").map((i) => i.value);
  // WhatsApp privacy IDs ("...@lid") stand in for a hidden number: they are not phone numbers.
  // Only phone and WhatsApp identities are numbers: an Instagram ID is a long number and a username is text.
  const phones = identities.filter((i) => (i.kind === "phone" || i.kind === "whatsapp") && !i.value.includes("@")).map((i) => i.value);
  const handles = identities.filter((i) => i.kind === "instagram_username").map((i) => i.value);
  const lids = identities.filter((i) => i.value.endsWith("@lid")).map((i) => i.value);
  const org = row.organizations ?? null;
  const who = { name: row.display_name, emails, phones, organizationName: org?.name ?? null };
  return {
    id: row.id,
    name: row.display_name,
    initials: initialsOf(row.display_name),
    hue: 0,
    emails,
    phones,
    handles: handles.length ? handles : undefined,
    lids: lids.length ? lids : undefined,
    company: row.company ?? undefined,
    role: row.role ?? undefined,
    avatarPath: row.avatar_path ?? companyLogo(who, logoAvatar(org?.logo_path)),
    isCompany: isCompanySender(who),
    organization: org ? { id: org.id, name: org.name, logoPath: org.logo_path ?? undefined } : undefined,
  };
}
