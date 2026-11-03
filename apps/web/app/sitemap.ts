// The sitemap search engines read: only the public marketing pages. The app itself is private and never listed.

import type { MetadataRoute } from "next";
import { MARKETING_PATHS } from "@/lib/marketing-routes";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return MARKETING_PATHS.map((path) => ({ url: `${SITE_URL}${path === "/" ? "" : path}`, changeFrequency: "monthly", priority: path === "/" ? 1 : 0.7 }));
}
