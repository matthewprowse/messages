import { cn } from "@/lib/utils";
import type { Provider } from "@/lib/types";

// The services' own logos, kept as small SVG files in public/logos (from each brand's official artwork,
// trimmed of editor metadata). A conversation shows the product it came through (Gmail, Outlook);
// connecting an account shows the company you sign in with (Google, Microsoft).

export type Brand = "google" | "microsoft" | "icloud" | "whatsapp" | "gmail" | "outlook";

const NAMES: Record<Brand, string> = {
  google: "Google",
  microsoft: "Microsoft",
  icloud: "iCloud",
  whatsapp: "WhatsApp",
  gmail: "Gmail",
  outlook: "Outlook",
};

const BY_PROVIDER: Partial<Record<Provider, Brand>> = {
  gmail: "gmail",
  whatsapp: "whatsapp",
  icloud: "icloud",
  outlook: "outlook",
};

/** A brand's logo. Decorative unless `label` is set, since it usually sits beside the brand's name. */
export function BrandLogo({ brand, className, label = false }: { brand: Brand; className?: string; label?: boolean }) {
  return (
    <img
      src={`/logos/${brand}.svg`}
      alt={label ? NAMES[brand] : ""}
      aria-hidden={label ? undefined : true}
      width={16}
      height={16}
      draggable={false}
      className={cn("size-4 shrink-0 object-contain", className)}
    />
  );
}

/** Where a conversation comes from, as the service's own logo. */
export function ProviderLogo({ provider, className }: { provider: Provider | undefined; className?: string }) {
  const brand = provider && BY_PROVIDER[provider];
  if (!brand) return null;
  return <BrandLogo brand={brand} label className={cn("size-3.5", className)} />;
}

/** Google's mark, for signing in with Google and connecting Gmail and Calendar together. */
export function GoogleLogo({ className }: { className?: string }) {
  return <BrandLogo brand="google" className={className} />;
}
