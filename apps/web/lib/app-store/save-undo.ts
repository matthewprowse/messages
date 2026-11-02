// What to put back when saving a Settings change fails, and which account changes are saved at all. Pure: the dispatch
// (use-profile-dispatch.ts) calls these around its database writes.

import type { Account, Profile } from "../types";
import type { Action, State } from "./reducer";

/** The account changes that are saved: a nickname, pausing, and resuming (the worker restarts a "connecting" account). */
export function savedAccountPatch(patch: Partial<Account>): Partial<Pick<Account, "nickname" | "status">> {
  const out: Partial<Pick<Account, "nickname" | "status">> = {};
  if (patch.nickname !== undefined) out.nickname = patch.nickname;
  if (patch.status === "disconnected" || patch.status === "connecting") out.status = patch.status;
  return out;
}

/** The action that puts back what `action` changed, or null when it changes nothing that is stored. */
export function undoFor(state: State, action: Action): Action | null {
  switch (action.type) {
    case "removeRule": {
      const rule = state.rules.find((r) => r.id === action.id);
      return rule ? { type: "addRule", rule } : null;
    }
    case "removeExample": {
      const example = state.writingExamples.find((w) => w.id === action.id);
      return example ? { type: "addExample", example } : null;
    }
    case "patchProfile": {
      const before: Partial<Profile> = {};
      for (const key of Object.keys(action.patch) as (keyof Profile)[]) (before as Record<string, unknown>)[key] = state.profile[key];
      return { type: "patchProfile", patch: before };
    }
    case "patchAccount": {
      const account = state.accounts.find((a) => a.id === action.id);
      if (!account) return null;
      const before: Partial<Account> = {};
      for (const key of Object.keys(action.patch) as (keyof Account)[]) (before as Record<string, unknown>)[key] = account[key];
      return { type: "patchAccount", id: action.id, patch: before };
    }
    default:
      return null;
  }
}
