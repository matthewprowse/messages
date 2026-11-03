"use client";

// The Attach menu: a Paperclip that offers This Device, Google Drive and OneDrive (the cloud ones only where this build has
// their keys; with none it opens the device's file chooser straight away, as before). Files from any source end up in the
// same onFiles, so they are checked, sealed and uploaded exactly like a local file. Used by replies, New Email and, as a
// dialog (cloud-attach-dialog.tsx), notes.

import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { ICLOUD_NOTE, SOURCE_LABEL } from "@/lib/cloud-pick/config";
import { useCloudPick, type PickRule } from "@/lib/cloud-pick/use-cloud-pick";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function AttachMenu({ rule, onFiles, notify, disabled, className }: { rule: PickRule; onFiles: (files: File[]) => void; notify: (message: string | null) => void; disabled?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const { sources, busy, pick } = useCloudPick({ rule, onFiles, notify });
  const picker = (
    <input
      ref={input}
      type="file"
      multiple
      hidden
      tabIndex={-1}
      onChange={(e) => {
        onFiles(Array.from(e.target.files ?? []));
        e.target.value = ""; // so the same file can be picked again after removing it
      }}
    />
  );
  const off = disabled || !!busy;
  if (sources.length === 0) {
    return (
      <>
        <Tip label="Attach Files"><Button type="button" variant="ghost" size="icon" className={className} aria-label="Attach Files" disabled={off} onClick={() => input.current?.click()}><Paperclip /></Button></Tip>
        {picker}
      </>
    );
  }
  return (
    <>
      <DropdownMenu>
        <Tip label="Attach Files">
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className={className} aria-label="Attach Files" disabled={off}><Paperclip /></Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="start" className="w-max max-w-72">
          <DropdownMenuItem onSelect={() => input.current?.click()}>This Device</DropdownMenuItem>
          {sources.map((s) => <DropdownMenuItem key={s} onSelect={() => void pick(s)}>{SOURCE_LABEL[s]}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="whitespace-normal text-xs font-normal text-muted-foreground">{ICLOUD_NOTE}</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
      {picker}
    </>
  );
}
