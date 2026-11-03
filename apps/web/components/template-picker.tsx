"use client";

// The button in the reply box and New Email that inserts a template: your own templates and snippets, and in a work chat the
// team's. Variables like {first_name} are filled from the person you write to; the text goes in where the box decides.

import Link from "next/link";
import { FileText } from "lucide-react";
import { useTemplates } from "@/lib/company-voice";
import { useUserTemplates } from "@/lib/use-user-templates";
import { fillVariables, type TemplateVars } from "@/lib/template-vars";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * Inserts one of your templates or snippets, or a team template (Settings, Team, Company Voice) when the chat is a work chat
 * (workspaceId is the chat's). vars fills {first_name}, {name}, {company} and {my_name}. onInsert gets the finished text; the
 * box decides where it goes. Typing ;shortcut does the same for a snippet (snippets.ts).
 */
export function TemplatePicker({ workspaceId, disabled, vars = {}, onInsert }: { workspaceId?: string | null; disabled?: boolean; vars?: TemplateVars; onInsert: (text: string) => void }) {
  const team = useTemplates(!!workspaceId);
  const mine = useUserTemplates().items;
  const templates = mine.filter((t) => t.kind === "template");
  const snippets = mine.filter((t) => t.kind === "snippet");
  const insert = (body: string) => onInsert(fillVariables(body, vars));
  return (
    <DropdownMenu>
      <Tip label="Insert Template">
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Insert Template" disabled={disabled}><FileText /></Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start" className="max-h-72 w-max max-w-64 overflow-y-auto">
        {templates.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Templates</DropdownMenuLabel>
            {templates.map((t) => <DropdownMenuItem key={t.id} onSelect={() => insert(t.body)}>{t.title}</DropdownMenuItem>)}
          </DropdownMenuGroup>
        )}
        {snippets.length > 0 && (
          <>
            {templates.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Snippets</DropdownMenuLabel>
              {snippets.map((t) => <DropdownMenuItem key={t.id} onSelect={() => insert(t.body)}><span className="truncate">{t.title}</span><span className="ml-auto pl-3 text-xs text-muted-foreground">;{t.shortcut}</span></DropdownMenuItem>)}
            </DropdownMenuGroup>
          </>
        )}
        {team.length > 0 && (
          <>
            {mine.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Team Templates</DropdownMenuLabel>
              {team.map((t) => <DropdownMenuItem key={t.id} onSelect={() => insert(t.body)}>{t.title}</DropdownMenuItem>)}
            </DropdownMenuGroup>
          </>
        )}
        {mine.length === 0 && team.length === 0 && (
          <DropdownMenuItem asChild><Link href="/settings/ai#templates">Add Your First Template</Link></DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
