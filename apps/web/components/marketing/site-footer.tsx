// The marketing site's footer: the links in three short columns, then the Konva wordmark across the full width,
// cut off by the bottom edge.

import Link from "next/link";
import { Logo } from "@/components/logo";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  { title: "Product", links: [{ href: "/#product", label: "Features" }, { href: "/#industries", label: "Industries" }, { href: "/pricing", label: "Pricing" }, { href: "/security", label: "Security" }, { href: "/updates", label: "Updates" }] },
  { title: "Konva", links: [{ href: "/request-access", label: "Request Access" }, { href: "/login", label: "Log In" }] },
  { title: "Legal", links: [{ href: "/privacy", label: "Privacy Policy" }, { href: "/terms", label: "Terms of Use" }] },
];

export function SiteFooter() {
  return (
    <footer className="overflow-hidden">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-4 pt-20 md:grid-cols-[1fr_repeat(3,auto)] md:gap-20 md:px-6">
        <div className="col-span-2 flex flex-col gap-3 md:col-span-1">
          <Link href="/" aria-label="Konva" className="w-fit rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><Logo className="w-6" /></Link>
          <p className="max-w-56 text-sm leading-6 text-muted-foreground">The client inbox for South African professionals.</p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title} className="flex flex-col gap-3 text-sm">
            <h2 className="font-medium">{c.title}</h2>
            <ul className="flex flex-col gap-2">
              {c.links.map((l) => <li key={l.href}><Link href={l.href} className="text-muted-foreground hover:text-foreground">{l.label}</Link></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-16 flex max-w-6xl items-center justify-between px-4 text-xs text-muted-foreground md:px-6">
        <span>© {new Date().getFullYear()} Konva</span>
        <span>Made in South Africa</span>
      </div>
      {/* The wordmark, sized to the page width and sunk into the bottom edge; decorative, so hidden from screen readers. */}
      <div aria-hidden className="pointer-events-none mx-auto mt-6 max-w-6xl select-none px-2 md:px-4">
        <p className="-mb-[0.22em] text-center text-[min(27vw,20rem)] leading-none font-semibold tracking-[-0.06em] text-foreground/[0.07] [mask-image:linear-gradient(to_bottom,black_40%,transparent)]">
          Konva
        </p>
      </div>
    </footer>
  );
}
