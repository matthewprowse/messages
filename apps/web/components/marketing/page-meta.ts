// Metadata for a marketing page in one call: title, description, canonical address and the link preview. A page's own
// openGraph replaces its parent's whole, so each one names the share image (/og.png) itself.

import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";

const IMAGE = { url: "/og.png", width: 1200, height: 630, alt: "Konva: Every Client Conversation, in One Place" };

/** `title` is used as written when `absolute`, otherwise as "Title · Konva" like every other page. */
export function pageMeta({ title, description, path, absolute = false }: { title: string; description: string; path: string; absolute?: boolean }): Metadata {
  const full = absolute ? title : `${title} · ${SITE_NAME}`;
  return {
    title: absolute ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { title: full, description, url: path, siteName: SITE_NAME, type: "website", locale: "en_ZA", images: [IMAGE] },
    twitter: { card: "summary_large_image", title: full, description, images: [IMAGE.url] },
  };
}
