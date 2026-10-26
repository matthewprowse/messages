import { useEffect, type RefObject } from "react";
import { wordOf } from "@messages/analytics";
import { takeSubmitted, track } from "./analytics";

/** The name of a form field, only if the code gave it one (a data-analytics, name or id), never what was typed in it. */
function fieldOf(el: EventTarget | null): string | undefined {
  if (!(el instanceof HTMLElement)) return undefined;
  const raw = el.getAttribute("data-analytics") ?? el.getAttribute("name") ?? el.id;
  return raw && !raw.startsWith("radix") ? wordOf(raw) : undefined;
}

// A dialog closing is reported a moment later. In development React mounts, unmounts and mounts again, which would
// otherwise read as a dialog opened, cancelled and opened.
const closing = new Map<string, ReturnType<typeof setTimeout>>();
const SETTLE_MS = 50;

/**
 * Records a dialog being opened and closed: how long it stayed open, whether it was submitted or
 * cancelled, and the names of the fields touched. A dialog's submit calls markSubmitted(name) first.
 */
export function useDialogTracking(name: string | undefined, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const dialog = wordOf(name);
    if (!dialog) return;
    const el = ref.current;
    const started = performance.now();
    const fields = new Set<string>();
    const touch = (event: Event) => {
      const field = fieldOf(event.target);
      if (field) fields.add(field);
    };
    const again = closing.get(dialog);
    if (again !== undefined) {
      clearTimeout(again);
      closing.delete(dialog);
    } else track("dialog_open", { dialog });
    el?.addEventListener("input", touch, true);
    el?.addEventListener("change", touch, true);
    return () => {
      el?.removeEventListener("input", touch, true);
      el?.removeEventListener("change", touch, true);
      const secs = Math.round((performance.now() - started) / 1000);
      closing.set(dialog, setTimeout(() => {
        closing.delete(dialog);
        track("dialog_close", { dialog, outcome: takeSubmitted(dialog) ? "submit" : "cancel", secs, fields: [...fields] });
      }, SETTLE_MS));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}
