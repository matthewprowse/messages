// The map of Settings: its sections in list order, and the cards and settings inside each, with the words people search
// them by. Pure, so the Settings list, its search and the links that moved can all be tested without a page. The icons are
// the layout's (app/settings/layout.tsx); the cards themselves carry the same ids.

/** A section of Settings, which is also its route under /settings. */
export type SettingsSectionKey = "profile" | "notifications" | "accounts" | "ai" | "drafts" | "automations" | "team" | "usage" | "privacy" | "whats-new" | "updates";

/** Who may see an entry: on a team, an owner or admin of it, one who oversees its work chats, or the app's owner. */
export type SettingsGate = "team" | "manager" | "oversight" | "owner";

/** What the signed-in person may see, worked out by the caller from their team and email. */
export interface SettingsAccess { team: boolean; manager: boolean; oversight: boolean; owner: boolean }

export interface SettingsSectionEntry { key: SettingsSectionKey; label: string; keywords: string; group: number; gate?: SettingsGate }

/** One card or one setting inside it. `card` is the id the page gives the card; `view` is the Team page's view it sits in. */
export interface SettingsEntry { section: SettingsSectionKey; card: string; title: string; keywords: string; view?: string; gate?: SettingsGate }

/** A search hit with where it goes and the section it belongs to. */
export interface SettingsHit extends SettingsEntry { href: string; sectionLabel: string }

export const SETTINGS_SECTIONS: SettingsSectionEntry[] = [
  { key: "profile", label: "Profile", keywords: "name photo account sign in security", group: 0 },
  { key: "notifications", label: "Notifications", keywords: "push alerts", group: 0 },
  { key: "accounts", label: "Accounts", keywords: "connect connected email whatsapp calendar linkedin instagram", group: 1 },
  { key: "ai", label: "AI", keywords: "personalisation personalization", group: 2 },
  { key: "drafts", label: "Drafts", keywords: "templates snippets writing voice", group: 2 },
  { key: "automations", label: "Automations", keywords: "leads rules", group: 2 },
  { key: "team", label: "Team", keywords: "workspace members", group: 3, gate: "team" },
  { key: "usage", label: "Usage", keywords: "allowance storage billing plan", group: 4 },
  { key: "privacy", label: "Privacy and Data", keywords: "export delete popia data", group: 4 },
  { key: "whats-new", label: "What's New", keywords: "updates changes release notes", group: 5 },
  { key: "updates", label: "Updates", keywords: "changelog", group: 6, gate: "owner" },
];

const e = (section: SettingsSectionKey, card: string, title: string, keywords = "", more: Partial<SettingsEntry> = {}): SettingsEntry => ({ section, card, title, keywords, ...more });

export const SETTINGS_ENTRIES: SettingsEntry[] = [
  e("profile", "profile", "Profile", "name"),
  e("profile", "profile", "Your Photo", "picture avatar image"),
  e("profile", "appearance", "Appearance", "theme dark light mode"),
  e("profile", "account", "Sign In", "sign out email log out"),
  e("profile", "account", "Run Setup Again", "onboarding start"),
  e("profile", "two-factor", "Two Factor Sign In", "2fa mfa authenticator code security"),
  e("profile", "sessions", "Active Sessions", "devices browsers sign out everywhere"),
  e("notifications", "push", "Push", "notifications this device"),
  e("notifications", "push", "Urgent", "push notifications"),
  e("notifications", "push", "Important", "push notifications"),
  e("notifications", "push", "Quiet Hours", "do not disturb night"),
  e("accounts", "connected", "Connected", "accounts pause resume reconnect rename sync"),
  e("accounts", "add-account", "Add an Account", "connect gmail google outlook microsoft icloud whatsapp instagram linkedin imap zoom"),
  e("accounts", "sending", "Sending", "send email"),
  e("accounts", "sending", "Undo Send", "delay take back"),
  e("accounts", "sending", "WhatsApp Read Receipts", "blue ticks seen"),
  e("accounts", "send-from", "Send From", "addresses alias from address"),
  e("accounts", "signatures", "Signatures", "sign off email footer default send from"),
  e("ai", "about", "About", "role goals important people"),
  e("ai", "writing-style", "Writing Style", "examples voice"),
  e("ai", "priorities", "Priorities", "rules always important never important senders domains"),
  e("ai", "ai-behaviour", "Behaviour", "ai"),
  e("ai", "ai-behaviour", "Auto Draft Replies", "drafts automatic"),
  e("ai", "ai-behaviour", "Draft Tone", "tone formal friendly"),
  e("ai", "ai-behaviour", "Language", "spelling british american afrikaans"),
  e("ai", "daily-brief", "Daily Brief", "brief voice speed time morning audio"),
  e("drafts", "templates", "Templates and Snippets", "shortcuts reusable text canned replies"),
  e("drafts", "drafts-use", "What Drafts Use", "learned sources profile"),
  e("drafts", "style-rules", "Learned Style Rules", "rules style learned edits"),
  e("drafts", "people-notes", "How You Write to People", "contacts notes style"),
  e("drafts", "companies", "Companies", "organisations organizations summaries"),
  e("automations", "templates", "Automation Templates", "property24 private property portals leads"),
  e("automations", "custom", "Custom Automations", "build create own"),
  e("automations", "history", "Run History", "runs undo"),
  e("team", "members", "Members", "people invite roles seats", { gate: "team" }),
  e("team", "sharing", "Strict Sharing", "compliance", { gate: "team" }),
  e("team", "shared", "What You Share", "shared chats work personal", { gate: "team" }),
  e("team", "inboxes", "Shared Inboxes", "info shared account", { gate: "team" }),
  e("team", "cover", "Cover", "away holiday leave", { gate: "team" }),
  e("team", "work-chats", "Work Chats", "assign clients reassign", { view: "work-chats", gate: "oversight" }),
  e("team", "response", "Response Times", "activity reply times unanswered", { view: "activity", gate: "manager" }),
  e("team", "moved-back", "Chats Moved Back to Personal", "activity", { view: "activity", gate: "manager" }),
  e("team", "company-profile", "Company Voice", "how the business writes tone sign off", { view: "voice", gate: "team" }),
  e("team", "company-templates", "Company Templates", "voice", { view: "voice", gate: "team" }),
  e("team", "company-facts", "Company Facts", "voice prices office hours", { view: "voice", gate: "team" }),
  e("team", "exports", "Compliance Exports", "records log export", { view: "exports", gate: "oversight" }),
  e("usage", "ai", "AI Allowance", "usage limit month week"),
  e("usage", "storage", "Storage", "files space biggest"),
  e("privacy", "usage-data", "Share Usage Data", "analytics privacy"),
  e("privacy", "download-data", "Download My Data", "export zip popia"),
  e("privacy", "connected-accounts", "Disconnect or Remove an Account", "connected accounts delete"),
  e("privacy", "delete-account", "Delete My Account", "close account popia"),
];

/** Old addresses of cards that moved to another section, so links written before the move still land on the card. */
export const MOVED_CARDS: Record<string, string> = {
  "/settings/ai#templates": "/settings/drafts#templates",
  "/settings/ai#drafts-use": "/settings/drafts#drafts-use",
  "/settings/accounts#read-receipts": "/settings/accounts#sending",
  "/settings/accounts#undo-send": "/settings/accounts#sending",
  "/settings/accounts#send-addresses": "/settings/accounts#send-from",
  "/settings/profile#privacy": "/settings/privacy#usage-data",
  "/settings/profile#download-data": "/settings/privacy#download-data",
  "/settings/profile#connected-accounts": "/settings/privacy#connected-accounts",
  "/settings/profile#delete-account": "/settings/privacy#delete-account",
};

/** Where an old path and hash now lives, or undefined when it has not moved. */
export const movedCard = (pathAndHash: string): string | undefined => MOVED_CARDS[pathAndHash];

const allowed = (gate: SettingsGate | undefined, access: SettingsAccess) => !gate || access[gate];

/** The sections this person may see, in list order. */
export const visibleSections = (access: SettingsAccess): SettingsSectionEntry[] => SETTINGS_SECTIONS.filter((s) => allowed(s.gate, access));

/** The address of a section. */
export const sectionHref = (key: SettingsSectionKey): string => `/settings/${key}`;

/** The address of a card: its section, the Team view it sits in, and the card's id as the hash. */
export const entryHref = (entry: Pick<SettingsEntry, "section" | "card" | "view">): string => `${sectionHref(entry.section)}${entry.view ? `?view=${entry.view}` : ""}#${entry.card}`;

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (text: string, terms: string[]) => { const hay = text.toLowerCase(); return terms.every((t) => hay.includes(t)); };

/** Sections and settings matching every word of the query that this person may see. An empty query matches nothing. */
export function searchSettings(query: string, access: SettingsAccess): { sections: SettingsSectionEntry[]; entries: SettingsHit[] } {
  const terms = words(query);
  if (terms.length === 0) return { sections: [], entries: [] };
  const sections = visibleSections(access);
  const label = new Map(sections.map((s) => [s.key, s.label]));
  const entries = SETTINGS_ENTRIES
    .filter((x) => label.has(x.section) && allowed(x.gate, access) && matches(`${x.title} ${x.keywords}`, terms))
    .map((x) => ({ ...x, href: entryHref(x), sectionLabel: label.get(x.section) ?? "" }));
  return { sections: sections.filter((s) => matches(`${s.label} ${s.keywords}`, terms)), entries };
}
