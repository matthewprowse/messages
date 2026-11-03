// Every app Konva connects to, running past in a loop (marketing.css). The list is drawn twice so the loop has no gap;
// the second copy is hidden from screen readers.

import { Mail } from "lucide-react";
import { BrandLogo } from "@/components/provider-logo";

type Brand = Parameters<typeof BrandLogo>[0]["brand"];

const APPS: { brand?: Brand; name: string }[] = [
  { brand: "whatsapp", name: "WhatsApp" },
  { brand: "gmail", name: "Gmail" },
  { brand: "outlook", name: "Outlook" },
  { brand: "icloud", name: "iCloud Mail" },
  { brand: "linkedin", name: "LinkedIn" },
  { brand: "instagram", name: "Instagram" },
  { brand: "whatsapp", name: "WhatsApp Business" },
  { brand: "google", name: "Google Calendar" },
  { brand: "microsoft", name: "Outlook Calendar" },
  { brand: "apple", name: "iCloud Calendar" },
  { brand: "google", name: "Google Tasks" },
  { brand: "microsoft", name: "Microsoft To Do" },
  { brand: "apple", name: "Reminders" },
  { name: "Any Other Email" },
];

function Row({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 gap-3 pr-3">
      {APPS.map((a) => (
        <li key={a.name} className="flex h-12 shrink-0 items-center gap-2.5 rounded-full border bg-background px-5 text-sm font-medium">
          {a.brand ? <BrandLogo brand={a.brand} className="size-5" /> : <Mail className="size-5 text-muted-foreground" aria-hidden />}
          {a.name}
        </li>
      ))}
    </ul>
  );
}

export function IntegrationsMarquee() {
  return (
    <div className="marquee overflow-hidden" aria-label="Apps Konva connects to">
      <div className="marquee-track flex w-max">
        <Row />
        <Row hidden />
      </div>
    </div>
  );
}
