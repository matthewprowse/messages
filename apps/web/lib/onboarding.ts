"use client";

import { useAuth } from "./auth";
import { supabase } from "./supabase";

// Where a new user is in setup, the tour and the page hints. Kept in the sign-in's user metadata, so it
// follows them to every device without a table of its own. It holds only these flags, never content.

/** The setup dialog's steps in order, then "done". */
export const SETUP_STEPS = ["accounts", "about", "learned", "contacts", "draft", "ready"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type OnboardingStep = SetupStep | "done";

export interface OnboardingMeta {
  /** The setup step someone is on. Unset for people from before onboarding, who see it only while they have no accounts. */
  onboarding?: OnboardingStep;
  /** "pending" from the end of setup until the tour is finished or skipped. */
  tour?: "pending" | "done";
  /** The page hints dismissed (or covered by the tour). */
  hints?: string[];
}

export function useOnboardingMeta(): OnboardingMeta {
  const { session } = useAuth();
  const meta = (session?.user.user_metadata ?? {}) as OnboardingMeta & Record<string, unknown>;
  return { onboarding: meta.onboarding, tour: meta.tour, hints: Array.isArray(meta.hints) ? meta.hints : undefined };
}

/** The name the sign-in gave us, from Google, when there is one. */
export function useSignInName(): string {
  const { session } = useAuth();
  const meta = session?.user.user_metadata ?? {};
  return String(meta.full_name ?? meta.name ?? "").trim();
}

/** Saves some of the flags. Supabase merges them into the rest of the metadata, and the session updates. */
export async function saveOnboarding(patch: OnboardingMeta) {
  const { error } = await supabase.auth.updateUser({ data: patch });
  if (error) throw error;
}

/** A POST to one of the app's own routes as the signed-in user. Rejects with the route's message. */
export async function postAsUser<T>(path: string, body: unknown = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in first.");
  const res = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Something went wrong. Try again.");
  return json;
}

/** Starts connecting Google: off to Google's sign-in, back to `back` afterwards. `meet` also asks for Meet transcripts and Google Chat. */
export async function connectGoogle(back: "/briefing" | "/settings/accounts/google", opts: { meet?: boolean } = {}) {
  const { url } = await postAsUser<{ url: string }>("/api/connect/google", { back, meet: opts.meet === true });
  window.location.assign(url);
}

/** Why Meet and Chat were not connected for a personal Google account. */
export const MEET_PERSONAL =
  "Meet transcripts and Google Chat need a Google Workspace account. This is a personal Google account, which has neither, so they were not connected.";

/** What ?connect_error= from the Google callback means, in words. */
export function googleErrorText(code: string): string {
  if (code === "cancelled") return "Google sign-in was cancelled. Try again when you are ready.";
  if (code === "not_granted") return "No access was given. Try again and leave the Gmail and Calendar boxes ticked.";
  if (code === "no_refresh") return "Google did not give lasting access. Remove Konva at myaccount.google.com/connections, then try again.";
  if (code === "expired") return "That sign-in took too long or was opened in another browser. Try again.";
  if (code === "meet_personal") return MEET_PERSONAL;
  return "Google could not be connected. Try again.";
}
