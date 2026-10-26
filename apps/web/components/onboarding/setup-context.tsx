"use client";

import { createContext, useContext } from "react";
import { CircleCheck, RefreshCw } from "lucide-react";
import type { SetupStep } from "@/lib/onboarding";
import type { ImportCounts, Role } from "@/lib/onboarding-demo";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

// What the setup dialog's steps share: who you are so far, the first import, and moving between steps.

export interface SetupState {
  step: SetupStep;
  /** The steps this person goes through: without an account there is nothing to learn from or tidy. */
  steps: SetupStep[];
  next: () => void;
  back: (() => void) | undefined;
  busy: boolean;
  name: string;
  setName: (name: string) => void;
  firstName: string;
  role: Role | "";
  setRole: (role: Role | "") => void;
  extra: string;
  setExtra: (extra: string) => void;
  photo: string | null;
  setPhoto: (url: string | null) => void;
  /** Which kinds of account are connected (or connecting). */
  channels: { mail: boolean; whatsapp: boolean };
  imported: { started: boolean; done: boolean; progress: number; counts: ImportCounts };
}

export const SetupContext = createContext<SetupState | null>(null);

export function useSetup(): SetupState {
  const value = useContext(SetupContext);
  if (!value) throw new Error("useSetup outside the setup dialog");
  return value;
}

/** One step: a title and description at the top, the step's content scrolling, its buttons at the bottom. */
export function StepFrame({ title, description, children, footer }: { title: string; description: string; children: React.ReactNode; footer: React.ReactNode }) {
  const { step, steps } = useSetup();
  const n = steps.indexOf(step) + 1;
  return (
    <>
      <div className="shrink-0 space-y-4 px-6 pt-6">
        <div className="flex items-center gap-3">
          <Progress value={(n / steps.length) * 100} className="h-1 flex-1" aria-label={`Step ${n} of ${steps.length}`} />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{n} of {steps.length}</span>
        </div>
        <div className="space-y-1">
          <DialogTitle className="text-lg font-medium">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-muted/50 px-6 py-4">
        <ImportStatus />
        <div className="ml-auto flex items-center gap-2">{footer}</div>
      </div>
    </>
  );
}

/** The first import, as it runs behind the dialog. */
function ImportStatus() {
  const { step, imported, channels } = useSetup();
  if (step === "accounts" || !imported.started) return <span />;
  if (imported.done) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleCheck className="size-3.5" /> First Import Done
      </span>
    );
  }
  const parts = [
    channels.mail && `${imported.counts.emails.toLocaleString()} emails`,
    channels.whatsapp && `${imported.counts.whatsapp.toLocaleString()} WhatsApp messages`,
  ].filter(Boolean);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <RefreshCw className="size-3.5 shrink-0 animate-spin" />
      <span className="truncate">Importing {parts.join(" and ")}</span>
    </span>
  );
}
