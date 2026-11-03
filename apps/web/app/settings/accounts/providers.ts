// How each provider looks on the Accounts page: its icon, and the list of accounts someone can add. Where each one
// connects is setupHrefOf in lib/account-groups.ts.

import { Calendar, ListChecks, Mail, MessageCircle, Video, type LucideIcon } from "lucide-react";
import type { Provider } from "@/lib/types";

export const PROVIDER_ICON: Record<Provider, LucideIcon> = {
  icloud: Mail, gmail: Mail, outlook: Mail, imap: Mail,
  google_calendar: Calendar, outlook_calendar: Calendar, icloud_calendar: Calendar,
  whatsapp: MessageCircle, linkedin: MessageCircle, instagram: MessageCircle,
  teams: Video, zoom: Video, google_meet: Video,
  microsoft_todo: ListChecks, google_tasks: ListChecks, icloud_reminders: ListChecks,
};

/** The accounts offered under Add an Account. */
export const ADD_ACCOUNTS: { href: string; label: string; provider: Provider }[] = [
  { href: "/settings/accounts/google", label: "Google", provider: "gmail" },
  { href: "/settings/accounts/microsoft", label: "Microsoft", provider: "outlook" },
  { href: "/settings/accounts/icloud", label: "iCloud", provider: "icloud" },
  { href: "/settings/accounts/whatsapp", label: "WhatsApp", provider: "whatsapp" },
  { href: "/settings/accounts/instagram", label: "Instagram", provider: "instagram" },
  { href: "/settings/accounts/linkedin", label: "LinkedIn", provider: "linkedin" },
  { href: "/settings/accounts/imap", label: "Other Email", provider: "imap" },
];
