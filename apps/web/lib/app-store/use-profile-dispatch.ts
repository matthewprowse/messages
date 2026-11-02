// The store's public dispatch: applies a change on screen straight away, then saves the ones that need saving
// (rules, writing examples, profile and account settings). Anything else goes straight to the reducer.

import { useCallback } from "react";
import { toast } from "sonner";
import { FIELD } from "@messages/crypto/fields";
import { ruleTargetIndex } from "@messages/crypto/addresses";
import { wordOf } from "@messages/analytics";
import { supabase } from "../supabase";
import { profilePatch } from "../data";
import { seal, userKeys } from "../vault";
import { sealAddress } from "../address-refs";
import { track } from "../analytics";
import type { Action } from "./reducer";

/** The dispatch the context exposes. Does nothing when signed out. */
export function useProfileDispatch({ userId, rawDispatch, saveFailed }: { userId: string | null; rawDispatch: React.Dispatch<Action>; saveFailed: () => void }) {
  /**
   * Applies a change on screen straight away, then saves it. Components call dispatch as before;
   * the database writes live here.
   */
  const dispatch = useCallback((action: Action) => {
    if (!userId) return;
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
        supabase.from("priority_rules").delete().eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
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
        supabase.from("writing_examples").delete().eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
        return;
      case "patchProfile":
        // Which settings changed, never their values.
        for (const key of Object.keys(action.patch)) {
          const setting = wordOf(key);
          if (setting) track("setting_changed", { setting });
        }
        rawDispatch(action);
        supabase.from("profiles").upsert({ user_id: userId, ...profilePatch(action.patch) }, { onConflict: "user_id" })
          .then(({ error }) => { if (error) saveFailed(); });
        return;
      case "patchAccount":
        rawDispatch(action);
        if (action.patch.nickname !== undefined) {
          supabase.from("accounts").update({ nickname: action.patch.nickname || null }).eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
        }
        if (action.patch.status === "disconnected") {
          // The sync worker notices within 30 seconds and stops that account.
          supabase.from("accounts").update({ status: "disconnected" }).eq("id", action.id).then(({ error }) => { if (error) saveFailed(); });
        }
        return;
      case "reset":
        toast("Not available yet.");
        return;
      default:
        rawDispatch(action);
    }
  }, [userId, saveFailed]);

  return { dispatch };
}
