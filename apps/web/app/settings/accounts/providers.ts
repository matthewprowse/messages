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
export const ADD_ACCOUNTS: { href: string; label: string; sub: string; provider: Provider }[] = [
  { href: "/settings/accounts/google", label: "Google", sub: "Gmail, Calendar and Tasks, with one sign-in", provider: "gmail" },
  { href: "/settings/accounts/microsoft", label: "Microsoft", sub: "Outlook, Calendar and To Do, with one sign-in", provider: "outlook" },
  { href: "/settings/accounts/icloud", label: "iCloud", sub: "Mail, Calendar and Reminders", provider: "icloud" },
  { href: "/settings/accounts/whatsapp", label: "WhatsApp", sub: "Scan a QR code", provider: "whatsapp" },
  { href: "/settings/accounts/instagram", label: "Instagram", sub: "Direct messages, Business, Creator or Personal", provider: "instagram" },
  { href: "/settings/accounts/linkedin", label: "LinkedIn", sub: "Messages, signed in with your LinkedIn account", provider: "linkedin" },
  { href: "/settings/accounts/imap", label: "Other Email", sub: "Any IMAP mailbox, like Afrihost, xneelo or cPanel", provider: "imap" },
];
