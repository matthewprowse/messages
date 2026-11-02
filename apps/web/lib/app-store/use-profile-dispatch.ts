// The store's public dispatch: applies a change on screen straight away, then saves the ones that need saving
// (rules, writing examples, profile and account settings). Anything else goes straight to the reducer.

import { useCallback } from "react";
import { FIELD } from "@messages/crypto/fields";
import { ruleTargetIndex } from "@messages/crypto/addresses";
import { wordOf } from "@messages/analytics";
import { supabase } from "../supabase";
import { profilePatch } from "../data";
import { sealProfileColumns } from "../data/profile-seal";
import { seal, userKeys } from "../vault";
import { sealAddress } from "../address-refs";
import { track } from "../analytics";
import type { Action, State } from "./reducer";
import { savedAccountPatch, undoFor } from "./save-undo";

/** The dispatch the context exposes. Does nothing when signed out. */
export function useProfileDispatch({ userId, rawDispatch, stateRef, saveFailed }: { userId: string | null; rawDispatch: React.Dispatch<Action>; stateRef: React.RefObject<State>; saveFailed: () => void }) {
  /**
   * Applies a change on screen straight away, then saves it. Components call dispatch as before;
   * the database writes live here.
   */
  const dispatch = useCallback((action: Action) => {
    if (!userId) return;
    // A save that fails puts the screen back as it was and says so, so a switch never shows a state the database lacks.
    const undo = undoFor(stateRef.current, action);
    const failed = () => { if (undo) rawDispatch(undo); saveFailed(); };
    switch (action.type) {
      case "addRule": {
        const rule = { ...action.rule, id: crypto.randomUUID() };
        track("feature_used", { feature: "priority_rule", detail: action.rule.kind });
        rawDispatch({ type: "addRule", rule });
        // Matched on the target's index, which is worked out here: the database cannot read the target.
        void userKeys()
          .then(async (keys) => ({ target: await sealAddress(rule.target), target_index: await ruleTargetIndex(keys, rule.target) }))
          .then((stored) => supabase.from("priority_rules").insert({ id: rule.id, user_id: userId, kind: rule.kind, ...stored }))
          .then(({ error }) => { if (error) { rawDispatch({ type: "removeRule", id: rule.id }); saveFailed(); } }, () => { rawDispatch({ type: "removeRule", id: rule.id }); saveFailed(); });
        return;
      }
      case "removeRule":
        rawDispatch(action);
        supabase.from("priority_rules").delete().eq("id", action.id).then(({ error }) => { if (error) failed(); }, failed);
        return;
      case "addExample": {
        const example = { ...action.example, id: crypto.randomUUID() };
        rawDispatch({ type: "addExample", example });
        // The situation and the text are sealed in the browser (fields writingSituation and writingBody).
        void Promise.all([seal(FIELD.writingSituation, example.context), seal(FIELD.writingBody, example.text)])
          .then(([situation, body]) => supabase.from("writing_examples").insert({ id: example.id, user_id: userId, situation, body }))
          .then(({ error }) => { if (error) { rawDispatch({ type: "removeExample", id: example.id }); saveFailed(); } }, () => { rawDispatch({ type: "removeExample", id: example.id }); saveFailed(); });
        return;
      }
      case "removeExample":
        rawDispatch(action);
        supabase.from("writing_examples").delete().eq("id", action.id).then(({ error }) => { if (error) failed(); }, failed);
        return;
      case "patchProfile":
        // Which settings changed, never their values.
        for (const key of Object.keys(action.patch)) {
          const setting = wordOf(key);
          if (setting) track("setting_changed", { setting });
        }
        rawDispatch(action);
        // About and Important People are sealed in the browser before they are stored.
        void sealProfileColumns(profilePatch(action.patch))
          .then((columns) => supabase.from("profiles").upsert({ user_id: userId, ...columns }, { onConflict: "user_id" }))
          .then(({ error }) => { if (error) failed(); }, failed);
        return;
      case "patchAccount": {
        // Only what is really stored is applied, so nothing shows that a refresh would lose. Pausing is noticed by
        // the sync worker within 30 seconds; resuming sets "connecting", which the worker restarts on.
        const patch = savedAccountPatch(action.patch);
        if (Object.keys(patch).length === 0) return;
        rawDispatch({ ...action, patch });
        const row = { ...(patch.nickname !== undefined && { nickname: patch.nickname || null }), ...(patch.status && { status: patch.status }) };
        supabase.from("accounts").update(row).eq("id", action.id).then(({ error }) => { if (error) failed(); }, failed);
        return;
      }
      default:
        rawDispatch(action);
    }
  }, [userId, stateRef, saveFailed]);

  return { dispatch };
}
