"use client";

// The Settings list beside a section, built like the Conversations list: the header with its search, then the sections as
// rows with a 40px icon, grouped, the open one highlighted. Typing narrows it to the matching sections and settings
// (lib/settings-index.ts), each setting with its section under it; picking one opens its card.

import { Fragment, useState, type KeyboardEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Gauge, Link2, Megaphone, PenLine, ScrollText, ShieldCheck, Sparkles, UserRound, Users, Zap, type LucideIcon } from "lucide-react";
import { useIsOwner } from "@/lib/auth";
import { useMyTeam } from "@/lib/share";
import { searchSettings, sectionHref, visibleSections, type SettingsAccess, type SettingsHit, type SettingsSectionKey } from "@/lib/settings-index";
import { PaneHeader } from "@/components/pane";
import { IconCircle, Row } from "@/components/surface";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { scrollToCard } from "@/components/settings/settings-page";
import { useWhatsNewUnseen } from "@/components/whats-new/use-whats-new";

const ICON: Record<SettingsSectionKey, LucideIcon> = {
  profile: UserRound, notifications: Bell, accounts: Link2, ai: Sparkles, drafts: PenLine, automations: Zap,
  team: Users, usage: Gauge, privacy: ShieldCheck, "whats-new": Megaphone, updates: ScrollText,
};

/** What the signed-in person may see in Settings, from their team role and email. */
function useSettingsAccess(): SettingsAccess {
  const team = useMyTeam();
  const owner = useIsOwner();
  const manager = team?.role === "owner" || team?.role === "admin";
  return { team: !!team, manager, oversight: manager || (team?.role === "compliance" && team.strict), owner };
}

export function SettingsList() {
  const pathname = usePathname();
  const router = useRouter();
  const access = useSettingsAccess();
  const unseen = useWhatsNewUnseen();
  const [search, setSearch] = useState("");
  const sections = visibleSections(access);
  // A few dozen entries, so it is simply worked out again on each keystroke.
  const found = searchSettings(search, access);
  const searching = search.trim().length > 0;

  const pick = (hit: SettingsHit) => {
    router.push(hit.href);
    // Picked from the open section, the address changes only its hash, so nothing remounts to scroll for us.
    scrollToCard(hit.card);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && search) { e.stopPropagation(); setSearch(""); }
    if (e.key !== "Enter") return;
    if (found.entries[0]) pick(found.entries[0]);
    else if (found.sections[0]) router.push(sectionHref(found.sections[0].key));
  };
  // The index shows Profile beside the list from tablet up, so its row is lit there too, but not on a phone.
  const isOpen = (key: SettingsSectionKey) => pathname === sectionHref(key) || pathname.startsWith(`${sectionHref(key)}/`);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PaneHeader title="Settings" search={{ value: search, onChange: setSearch, placeholder: "Search Settings", onKeyDown }} />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Settings" className="p-3">
          {searching ? (
            found.sections.length + found.entries.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No Matches</p>
            ) : (
              <div className="flex flex-col gap-2">
                {found.sections.map((s, i) => (
                  <Fragment key={s.key}>
                    {i > 0 && <div className="pl-16"><Separator /></div>}
                    <Row href={sectionHref(s.key)} lead={<IconCircle icon={ICON[s.key]} />} title={s.label} active={isOpen(s.key)} />
                  </Fragment>
                ))}
                {found.entries.map((x, i) => (
                  <Fragment key={`${x.section}-${x.card}-${x.title}`}>
                    {(i > 0 || found.sections.length > 0) && <div className="pl-16"><Separator /></div>}
                    <Row onClick={() => pick(x)} lead={<IconCircle icon={ICON[x.section]} />} title={x.title} detail={x.sectionLabel} />
                  </Fragment>
                ))}
              </div>
            )
          ) : (
            <div className="flex flex-col gap-2">
              {sections.map((s, i) => (
                <Fragment key={s.key}>
                  {i > 0 && (s.group === sections[i - 1].group ? <div className="pl-16"><Separator /></div> : <div className="px-3 py-2"><Separator /></div>)}
                  <Row
                    href={sectionHref(s.key)}
                    lead={<IconCircle icon={ICON[s.key]} />}
                    title={s.label}
                    active={isOpen(s.key) || (pathname === "/settings" && s.key === "profile")}
                    className={pathname === "/settings" && s.key === "profile" ? "max-md:bg-transparent" : undefined}
                    end={s.key === "whats-new" && unseen ? <span role="img" aria-label="New" className="size-2 rounded-full bg-primary" /> : undefined}
                  />
                </Fragment>
              ))}
            </div>
          )}
        </nav>
      </ScrollArea>
    </div>
  );
}
