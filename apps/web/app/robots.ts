// robots.txt: crawl the marketing pages, stay out of the API, and find the sitemap. App pages also say noindex
// themselves (app/layout.tsx), so a link to one from elsewhere is still not indexed.

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
