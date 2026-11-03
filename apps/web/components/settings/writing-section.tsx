"use client";

// Settings, AI, Writing Style: messages you actually sent, used as the voice for people you have not written to yet.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SettingsBody, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

/** The saved writing examples with a form to add one. A failed save puts the example back (see use-profile-dispatch.ts). */
export function WritingSection() {
  const { writingExamples, dispatch, notify } = useApp();
  const [context, setContext] = useState("");
  const [text, setText] = useState("");
  // `required` lets whitespace through, so blank examples are refused here.
  const addExample = () => {
    const example = { context: context.trim(), text: text.trim() };
    if (!example.context || !example.text) return;
    dispatch({ type: "addExample", example: { id: `w-${Date.now()}`, ...example } });
    setContext("");
    setText("");
    notify("Example added");
  };
  return (
    <SettingsSection id="writing-style" title="Writing Style">
      {writingExamples.length > 0 && (
        <SettingsRows>
          {writingExamples.map((w) => (
            <SettingsRow key={w.id} title={w.context} description={w.text}>
              <Button variant="ghost" size="icon" aria-label={`Remove Example: ${w.context}`} onClick={() => { dispatch({ type: "removeExample", id: w.id }); notify("Example removed", () => dispatch({ type: "addExample", example: w })); }}><Trash2 /></Button>
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      <SettingsBody>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); addExample(); }}>
          <div className="grid gap-2"><Label htmlFor="ctx">Situation</Label><Input id="ctx" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Replying to a client" required /></div>
          <div className="grid gap-2"><Label htmlFor="txt">Example</Label><Textarea id="txt" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a message you actually sent" required /></div>
          <Button variant="secondary" type="submit">Add Example</Button>
        </form>
      </SettingsBody>
    </SettingsSection>
  );
}
