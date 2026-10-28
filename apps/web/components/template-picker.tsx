"use client";

// The button in the reply box that inserts a team template. Hidden outside work chats and when the team has none.

import { FileText } from "lucide-react";
import { useTemplates } from "@/lib/company-voice";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * Inserts one of the team's templates (Settings, Team, Company Voice) into a reply box. It shows only in a work chat
 * (workspaceId is the chat's) and only when the team has templates, so a personal chat's reply box is exactly as it was.
 * onInsert gets the template's text; the reply box decides where it goes.
 */
export function TemplatePicker({ workspaceId, disabled, onInsert }: { workspaceId?: string | null; disabled?: boolean; onInsert: (text: string) => void }) {
  const templates = useTemplates(!!workspaceId);
  if (!workspaceId || templates.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Insert Template" title="Insert Template" disabled={disabled}><FileText /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-max max-w-64 overflow-y-auto">
        {templates.map((t) => <DropdownMenuItem key={t.id} onSelect={() => onInsert(t.body)}>{t.title}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
