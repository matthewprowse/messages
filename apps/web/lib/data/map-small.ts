// Maps the small tables (accounts, profile, drafts, unsubscribes) to app types, and a profile change back to columns.
// Pure: no network, no database.

import type { Tables } from "@messages/db";
import type { Account, AccountStatus, Draft, Profile, Provider, Unsubscribe } from "../types";
import type { ChoiceKind } from "../choices";
import type { AccountRow, DraftRow, ProfileRow, UnsubscribeRow } from "./columns";

export const EMPTY_PROFILE: Profile = {
  name: "",
  avatarPath: null,
  about: "",
  people: "",
  quietStart: "22:00",
  quietEnd: "07:30",
  pushUrgent: true,
  pushImportant: true,
  autoDraftTop: true,
  whatsappReadReceipts: true,
  shareUsage: true,
  language: null,
};

export function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    provider: row.provider as Provider,
    label: row.label,
    nickname: row.nickname ?? undefined,
    detail: row.address,
    status: row.status as AccountStatus,
    statusDetail: row.status_detail ?? undefined,
    lastSync: row.last_synced_at ?? undefined,
    sendAddresses: row.send_addresses ?? [],
  };
}

export function mapProfile(row: ProfileRow | null): Profile {
  if (!row) return EMPTY_PROFILE;
  return {
    name: row.display_name ?? "",
    avatarPath: row.avatar_path,
    about: row.about ?? "",
    people: row.important_people ?? "",
    quietStart: row.quiet_start.slice(0, 5),
    quietEnd: row.quiet_end.slice(0, 5),
    pushUrgent: row.push_urgent,
    pushImportant: row.push_important,
    autoDraftTop: row.auto_draft_top,
    whatsappReadReceipts: row.whatsapp_read_receipts,
    shareUsage: row.share_usage,
    language: row.language as Profile["language"],
  };
}

/** Profile fields as database columns, for saving a partial change. */
export function profilePatch(patch: Partial<Profile>) {
  const out: Partial<Tables<"profiles">> = {};
  if (patch.name !== undefined) out.display_name = patch.name;
  if (patch.avatarPath !== undefined) out.avatar_path = patch.avatarPath;
  if (patch.about !== undefined) out.about = patch.about;
  if (patch.people !== undefined) out.important_people = patch.people;
  if (patch.quietStart !== undefined) out.quiet_start = patch.quietStart;
  if (patch.quietEnd !== undefined) out.quiet_end = patch.quietEnd;
  if (patch.pushUrgent !== undefined) out.push_urgent = patch.pushUrgent;
  if (patch.pushImportant !== undefined) out.push_important = patch.pushImportant;
  if (patch.autoDraftTop !== undefined) out.auto_draft_top = patch.autoDraftTop;
  if (patch.whatsappReadReceipts !== undefined) out.whatsapp_read_receipts = patch.whatsappReadReceipts;
  if (patch.shareUsage !== undefined) out.share_usage = patch.shareUsage;
  if (patch.language !== undefined) out.language = patch.language;
  return out;
}

export function mapDraft(row: DraftRow): Draft {
  return {
    id: row.id,
    body: row.body,
    tone: row.tone as Draft["tone"],
    instruction: row.instruction ?? undefined,
    decision: row.decision && row.decision_kind ? { text: row.decision, kind: row.decision_kind as ChoiceKind } : undefined,
    source: row.source ?? undefined,
    auto: row.auto || undefined,
    generatedAt: row.updated_at,
  };
}

export function mapUnsubscribe(row: UnsubscribeRow): Unsubscribe {
  return {
    id: row.id,
    accountId: row.account_id,
    sender: row.sender_address,
    status: row.status as Unsubscribe["status"],
    manualUrl: row.manual_url ?? undefined,
    error: row.error ?? undefined,
  };
}
