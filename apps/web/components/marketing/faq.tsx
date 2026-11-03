// Questions and answers in two columns, all visible: easier to scan than an accordion, and every answer is on the
// page for search engines. Pages pair it with faqData() for the FAQ structured data.

import { Heading } from "./section";

export function Faq({ items, title = "Frequently Asked Questions" }: { items: { q: string; a: string }[]; title?: string }) {
  return (
    <>
      <Heading title={title} center />
      <dl className="mx-auto mt-14 grid max-w-4xl gap-x-16 gap-y-10 md:grid-cols-2">
        {items.map((f) => (
          <div key={f.q} className="flex flex-col gap-2">
            <dt className="text-sm font-medium">{f.q}</dt>
            <dd className="text-sm leading-6 text-muted-foreground">{f.a}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
