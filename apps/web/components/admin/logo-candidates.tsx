"use client";

// The dialogs of Admin's Logos view: every candidate for one company's logo, framed as it would show with the judge's
// reason, to choose one by hand or reject the chosen one; and the question before rejecting a logo from its row. Both apply
// to every user; the workers do the work, an action here only queues it.

import { useState } from "react";
import { toast } from "sonner";
import { chooseLogo, rejectLogo, SOURCE_LABELS, type CompanyLogo, type LogoCandidate } from "@/lib/company-logos";
import { useSignedUrl } from "@/lib/signed-urls";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Row, Separated } from "@/components/surface";

/** One framed candidate as the round avatar it would be. */
function CandidateImage({ path, size }: { path: string; size: "size-10" | "size-20" }) {
  const url = useSignedUrl("logos", path) ?? undefined;
  return <Avatar className={size}>{url && <AvatarImage src={url} alt="" className="object-cover" />}</Avatar>;
}

/** Every candidate from the latest look (or search) for one company. Closes after an action and asks the list to reload. */
export function CandidatesDialog({ logo, onClose, onChanged }: { logo: CompanyLogo | null; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (what: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast(done);
      onChanged();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Turned down in this round, by number; the first round's are kept apart when a search followed.
  const current = new Set(logo?.candidates.map((c) => c.path));
  const reasons = new Map(logo?.rejected.filter((r) => !r.path || current.has(r.path)).map((r) => [r.n, r.reason]));
  const firstLook = logo?.rejected.filter((r) => r.path && !current.has(r.path)) ?? [];
  return (
    <Dialog open={!!logo} onOpenChange={(o) => !o && onClose()}>
      {logo && (
        <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{logo.name}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            {logo.candidates.length === 0 ? <p className="text-sm text-muted-foreground">No Candidates Found</p> : (
              <Separated inset="none">
                {logo.candidates.map((c: LogoCandidate) => {
                  const chosen = c.n === logo.pick && logo.status === "done" && !!logo.path;
                  return (
                    <div key={c.n} className="flex items-center gap-3 p-3">
                      <CandidateImage path={c.path} size="size-20" />
                      <CandidateImage path={c.path} size="size-10" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-center gap-2 text-sm font-medium">{c.n}. {SOURCE_LABELS[c.source]}{chosen && <Badge variant="secondary">Chosen</Badge>}</span>
                        <span className="text-xs text-muted-foreground">{chosen ? logo.verdict : (reasons.get(c.n) ?? c.note ?? "")}</span>
                      </div>
                      {chosen ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => rejectLogo(logo.domain, c.n), "Searching Again Without It")}>Reject</Button>
                      ) : (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => chooseLogo(logo.domain, c.n), "Saved For Every User")}>Use This</Button>
                      )}
                    </div>
                  );
                })}
              </Separated>
            )}
            {logo.round === 2 && firstLook.length > 0 && (
              <>
                <h3 className="mt-3 px-3 text-sm text-muted-foreground">First Look, Before Searching</h3>
                <Separated>
                  {firstLook.map((r) => (
                    <Row key={r.path} lead={<CandidateImage path={r.path!} size="size-10" />} title={r.source ? SOURCE_LABELS[r.source] : "Unknown"} detail={r.reason} />
                  ))}
                </Separated>
              </>
            )}
          </ScrollArea>
          <div className={DIALOG_BUTTONS}>
            <Button variant="secondary" onClick={onClose}>Done</Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Asks before a chosen logo is rejected from its row; it is looked for again without it and never offered again. */
export function RejectLogoDialog({ logo, onClose, onConfirm }: { logo: CompanyLogo | null; onClose: () => void; onConfirm: (logo: CompanyLogo) => void }) {
  return (
    <Dialog open={!!logo} onOpenChange={(o) => !o && onClose()}>
      {logo && (
        <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject {logo.name}&apos;s Logo?</DialogTitle>
          </DialogHeader>
          <div className={DIALOG_BUTTONS}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="secondary" onClick={() => onConfirm(logo)}>Reject</Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
