// Pure helpers for starting an Instagram conversation from the New menu. The database policy and the
// Instagram connector check the same limits.

import type { Account } from "./types";
import { INSTAGRAM_OFFICIAL_LABEL } from "../app/api/connect/instagram/official/shared";

export const INSTAGRAM_HINT = "Enter an Instagram username, like ana.m.";
export const INSTAGRAM_OFFICIAL_NOTICE =
  "Instagram only lets a Business or Creator account message people who have messaged it first, so this account cannot start a conversation. Use a personal Instagram account, or start it in Instagram.";

/** What Instagram allows in a username, lowercase. */
const USERNAME = /^[a-z0-9._]{1,30}$/;

/** The username in what was typed: no spaces around it, no @, no profile link, lowercase. */
export function normaliseUsername(value: string): string {
  const text = value.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, "");
  return text.split("/")[0].split("?")[0].replace(/^@+/, "");
}

/** The username to message, or null when what was typed is not one. */
export function instagramUsername(value: string): string | null {
  const name = normaliseUsername(value);
  return USERNAME.test(name) ? name : null;
}

/** A Business or Creator account on the official API, which cannot message people first. */
export function isOfficialAccount(account: Pick<Account, "label">): boolean {
  return account.label === INSTAGRAM_OFFICIAL_LABEL;
}

/** The Instagram accounts that are connected, personal ones (which can start conversations) first. */
export function instagramAccounts<T extends Pick<Account, "provider" | "label" | "status">>(accounts: T[]): T[] {
  return accounts
    .filter((a) => a.provider === "instagram" && (a.status === "connected" || a.status === "syncing"))
    .sort((a, b) => Number(isOfficialAccount(a)) - Number(isOfficialAccount(b)));
}

/** True when a connected Instagram account is there to choose. */
export function instagramLinked(accounts: Pick<Account, "provider" | "label" | "status">[]) {
  return instagramAccounts(accounts).length > 0;
}
