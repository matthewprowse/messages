"use client";

// The Attach menu's cloud half as a hook: opens a picker, checks sizes before downloading, downloads the chosen files and
// hands them to the same onFiles a local file goes to (so sealing, limits and upload are unchanged). Says what went
// wrong in a plain sentence through notify.

import { useCallback, useState } from "react";
import { availableSources, cloudConfig, SOURCE_LABEL } from "./config";
import { downloadPick } from "./download";
import { pickFromGoogleDrive } from "./google";
import { pickFromOneDrive } from "./onedrive";
import { precheckPicks, type CloudSource } from "./pick-map";
import type { AttachProvider } from "@/lib/outbox-files";

/** How the files being added are checked: a message's service limits, or one cap per file (notes). */
export type PickRule = { provider: AttachProvider; existing: () => { name: string; size: number }[] } | { maxBytes: number };

export function useCloudPick(opts: { rule: PickRule | null; onFiles: (files: File[]) => void; notify: (message: string | null) => void }) {
  const [busy, setBusy] = useState<CloudSource | null>(null);
  const { rule, onFiles, notify } = opts;

  /** Must be called straight from a click: OneDrive opens its popup before anything is awaited. */
  const pick = useCallback(async (source: CloudSource) => {
    if (busy || !rule) return;
    setBusy(source);
    notify(null);
    try {
      const result = source === "google" ? await pickFromGoogleDrive(cloudConfig.google!) : await pickFromOneDrive(cloudConfig.onedrive!);
      if (!result) return;
      const problems = [...result.errors];
      const sizeRule = "maxBytes" in rule ? rule : { provider: rule.provider, existing: rule.existing() };
      const tooBig = precheckPicks(result.picks, sizeRule);
      if (tooBig) { notify(tooBig); return; }
      const files: File[] = [];
      for (const p of result.picks) {
        try {
          files.push(await downloadPick(p, result.token));
        } catch (e) {
          problems.push(e instanceof Error ? e.message : `${p.name} did not download.`);
        }
      }
      if (files.length > 0) onFiles(files);
      notify(problems.length > 0 ? problems.join(" ") : null);
    } catch (e) {
      const why = e instanceof Error ? e.message : "";
      // Closing the sign-in window is a choice, not an error.
      if (why === "closed") return;
      notify(why === "popup" ? `Allow pop-ups for this page to choose from ${SOURCE_LABEL[source]}.` : `${SOURCE_LABEL[source]} could not be opened. Try again.`);
    } finally {
      setBusy(null);
    }
  }, [busy, rule, onFiles, notify]);

  return { sources: availableSources(), busy, pick };
}
