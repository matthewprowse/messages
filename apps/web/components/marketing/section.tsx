// The building blocks every marketing page is made of, so spacing and type stay the same across pages: a section that
// rises in as it scrolls into view, a section heading with its lead paragraph, and the page's own opening with its h1.

import { cn } from "@/lib/utils";

/** A full width band with the page's width and gutters. Every section but the first rises in on scroll (marketing.css). */
export function Section({ id, className, children, first = false }: { id?: string; className?: string; children: React.ReactNode; first?: boolean }) {
  return (
    <section id={id} className="scroll-mt-14">
      <div className={cn("mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28", !first && "reveal", className)}>{children}</div>
    </section>
  );
}

/** A section heading and the muted paragraph under it, centred unless it sits beside something. */
export function Heading({ title, lead, center = false, className }: { title: string; lead?: React.ReactNode; center?: boolean; className?: string }) {
  return (
    <div className={cn("flex max-w-xl flex-col gap-4", center && "mx-auto items-center text-center", className)}>
      <h2 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">{title}</h2>
      {lead && <p className="text-base leading-7 text-muted-foreground text-pretty">{lead}</p>}
    </div>
  );
}

/** A page's opening, centred: its one h1, the lead under it and its buttons. */
export function PageIntro({ title, lead, children, className }: { title: string; lead?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto flex max-w-3xl flex-col items-center text-center", className)}>
      <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-6xl">{title}</h1>
      {lead && <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground text-pretty">{lead}</p>}
      {children && <div className="mt-8 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** A soft card: the surface every feature, pillar and plan sits on. */
export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-2xl border bg-muted/30 p-6 md:p-8", className)}>{children}</div>;
}
