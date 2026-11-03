// Structured data for search engines: a script tag of schema.org JSON, and builders for the shapes the pages share.

import { SITE_NAME, SITE_URL } from "@/lib/site";

/** Renders schema.org data. JSON.stringify leaves "<" alone, which could close the tag early, so it is escaped. */
export function JsonLd({ data }: { data: object | object[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/** A FAQPage from question and answer pairs. */
export function faqData(faq: { q: string; a: string }[]) {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
}

/** The trail from Home to this page, for the breadcrumb under a search result. */
export function breadcrumbData(name: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
      { "@type": "ListItem", position: 2, name, item: `${SITE_URL}${path}` },
    ],
  };
}
