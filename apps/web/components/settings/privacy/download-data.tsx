"use client";

// Settings, Privacy and Data: Download My Data (POPIA right of access). Builds a zip of everything the person owns in THIS
// browser, opening it with their own key, so the server never sees a readable word of it. Shows progress, can be cancelled, and
// says plainly that it takes a while. The work is in lib/data-export/.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { buildExport, ExportCancelled, type ExportProgress } from "@/lib/data-export/build-export";
import { estimateText, totalUsage, type UsageRow } from "@/lib/data-export/estimate";
import { browserExportSource } from "@/lib/data-export/export-source";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

/** Saves a blob as a file by clicking a temporary link; the object URL is released a little later so the download can start. */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function DownloadDataSection() {
  const [files, setFiles] = useState(false);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);

  // The size estimate is the same storage_usage view as Settings, Storage; it is only a guide, so a failure just hides it.
  useEffect(() => {
    let cancelled = false;
    supabase.from("storage_usage").select("kind, files, bytes").then(({ data }) => { if (!cancelled && data) setUsage(data as UsageRow[]); });
    // Leaving the page while it builds stops the build rather than leaving it running unseen.
    return () => { cancelled = true; controller.current?.abort(); };
  }, []);

  async function start() {
    const run = new AbortController();
    controller.current = run;
    setRunning(true);
    setProgress({ stage: "Starting", done: 0, total: 1 });
    try {
      const blob = await buildExport(browserExportSource(), { attachments: files }, setProgress, run.signal);
      save(blob, `konva-my-data-${new Date().toISOString().slice(0, 10)}.zip`);
      toast.success("Your data is ready. Check your downloads.");
    } catch (err) {
      if (err instanceof ExportCancelled) toast("Download cancelled. Nothing was saved.");
      else toast.error("Your data could not be put together. Try again, and tell us if it keeps happening.");
    } finally {
      controller.current = null;
      setRunning(false);
      setProgress(null);
    }
  }

  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return (
    <SettingsSection id="download-data" title="Download My Data">
      <SettingsRows>
        <SettingsRow title="Include Files" description={estimateText(usage ? totalUsage(usage) : null)}>
          <Switch checked={files} onCheckedChange={setFiles} disabled={running} aria-label="Include Files" />
        </SettingsRow>
        <SettingsRow title="Make My Download">
          {running ? (
            <Button variant="secondary" onClick={() => controller.current?.abort()}>Cancel</Button>
          ) : (
            <Button variant="secondary" onClick={start}>Download My Data</Button>
          )}
        </SettingsRow>
      </SettingsRows>
      {running && progress && (
        <div className="space-y-2 p-3" role="status" aria-live="polite">
          <Progress value={percent} aria-label="Download progress" />
          <p className="text-xs text-muted-foreground">{progress.stage}{progress.total > 1 ? `, ${progress.done.toLocaleString("en-GB")} of ${progress.total.toLocaleString("en-GB")}` : ""}</p>
        </div>
      )}
    </SettingsSection>
  );
}
