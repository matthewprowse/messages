"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { MOCK_SUGGESTIONS, type ContactSuggestion } from "@/lib/onboarding-demo";
import { BrandLogo } from "@/components/provider-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StepFrame, useSetup } from "./setup-context";

// 4. Contacts Konva is unsure of: people it would join together, and one it thinks is two people. Each
// is decided here in a tap. MOCK: the suggestions come from the contact linker once it reports them.

type Decision = "accepted" | "declined";

export function ContactsStep() {
  const { next, back, busy, imported } = useSetup();
  const [decided, setDecided] = useState<Record<string, Decision>>({});
  const open = MOCK_SUGGESTIONS.filter((s) => !decided[s.id]);
  const acceptAll = () => setDecided((d) => Object.fromEntries(MOCK_SUGGESTIONS.map((s) => [s.id, d[s.id] ?? "accepted"])));

  return (
    <StepFrame
      title="Tidy Up Your Contacts"
      description={`Konva joined most of your ${imported.counts.contacts.toLocaleString()} contacts across email and WhatsApp on its own. It wants a quick yes or no on these.`}
      footer={
        <>
          {back && <Button variant="ghost" disabled={busy} onClick={back}>Back</Button>}
          {open.length > 0 && <Button variant="outline" disabled={busy} onClick={acceptAll}>Accept All</Button>}
          <Button disabled={busy} onClick={next}>{open.length > 0 ? "Decide Later" : "Continue"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {MOCK_SUGGESTIONS.map((s) => (
          <Suggestion key={s.id} s={s} decision={decided[s.id]} onDecide={(d) => setDecided({ ...decided, [s.id]: d })} onUndo={() => { const { [s.id]: _, ...rest } = decided; setDecided(rest); }} />
        ))}
        <p className="text-xs text-muted-foreground">New suggestions appear in Contacts, under Merges, as more messages arrive.</p>
      </div>
    </StepFrame>
  );
}

function Suggestion({ s, decision, onDecide, onUndo }: { s: ContactSuggestion; decision?: Decision; onDecide: (d: Decision) => void; onUndo: () => void }) {
  const merge = s.action === "merge";
  const outcome = decision === "accepted" ? (merge ? `Merged into ${s.name}` : `Split into ${s.into?.join(" and ")}`) : merge ? "Kept Separate" : "Kept Together";
  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            {s.name} <Badge variant="outline">{merge ? "Same Person?" : "Two People?"}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{s.reason}</p>
        </div>
      </div>
      <ul className="space-y-1.5 px-4 py-3">
        {s.identities.map((id) => (
          <li key={id.value} className="flex items-center gap-2 text-sm">
            {id.kind === "whatsapp" ? <BrandLogo brand="whatsapp" /> : <Mail className="size-4 shrink-0 text-muted-foreground" />}
            <span className="truncate">{id.value}</span>
            <span className="truncate text-xs text-muted-foreground">{id.label}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
        {decision ? (
          <>
            <span className="mr-auto text-xs text-muted-foreground">{outcome}</span>
            <Button variant="ghost" size="sm" onClick={onUndo}>Undo</Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => onDecide("declined")}>{merge ? "Keep Separate" : "Keep Together"}</Button>
            <Button size="sm" onClick={() => onDecide("accepted")}>{merge ? "Merge" : "Split"}</Button>
          </>
        )}
      </div>
    </div>
  );
}
