// The long text pages (Privacy Policy, Terms of Use): a narrow reading column with numbered sections, and a marker for
// the company details the template still needs, so none is missed before launch.

import { cn } from "@/lib/utils";
import { Section } from "./section";

/** A detail still to fill in, such as the registered company's name. Highlighted so it stands out on the page. */
export function Fill({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">[{children}]</span>;
}

/** A legal page: its title and date, then its sections. */
export function LegalPage({ title, updated, intro, children }: { title: string; updated: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <Section first>
      <article className="mx-auto max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{title}</h1>
        <p className="mt-4 text-sm text-muted-foreground">Last updated {updated}</p>
        <div className="mt-10 text-base leading-7 text-muted-foreground">{intro}</div>
        <div className="mt-12 flex flex-col gap-12">{children}</div>
      </article>
    </Section>
  );
}

/** One numbered section of a legal page. */
export function Clause({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">{n}. {title}</h2>
      <div className="flex flex-col gap-4 text-sm leading-7 text-muted-foreground [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">{children}</div>
    </section>
  );
}

/** A plain link inside legal text. */
export function TextLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return <a href={href} className={cn("text-foreground underline underline-offset-4", className)}>{children}</a>;
}
