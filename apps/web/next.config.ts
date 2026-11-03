// Next.js config for the web app: the security headers sent with every response. The Content Security Policy is
// not here; middleware.ts sets it per request because it needs a fresh nonce for each page.

import type { NextConfig } from "next";

// Safe defaults for every page.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Voice notes need the microphone, so it stays allowed for this site.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), microphone=(self)" },
  // The provider sign-ins are full-page redirects, not popups, so isolating the window is safe.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pages are driven from the in-memory store, so a cached page payload carries no data: keep visited pages for 30 s
  // in the router cache instead of fetching them from the server on every rail click.
  experimental: { staleTimes: { dynamic: 30 } },
  headers: async () => [
    { source: "/:path*", headers: securityHeaders },
    // Voice samples and provider logos rarely change; a day in the cache, a week of serving stale while it refreshes.
    { source: "/voices/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    { source: "/logos/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
  ],
  // The Summary page was at /briefing until 27 October 2026; old links and bookmarks still land on it.
  redirects: async () => [
    { source: "/briefing", destination: "/summary", permanent: true },
    { source: "/briefing/:id", destination: "/summary/:id", permanent: true },
    // Settings was regrouped into six pages on 2 November 2026; saved links and the ?add= prefill still land in the right place.
    { source: "/settings/personalisation", destination: "/settings/ai", permanent: true },
    { source: "/settings/writing", destination: "/settings/ai#writing-style", permanent: true },
    { source: "/settings/rules", destination: "/settings/ai#priorities", permanent: true },
    { source: "/settings/general", destination: "/settings/profile", permanent: true },
    { source: "/settings/appearance", destination: "/settings/profile#appearance", permanent: true },
    { source: "/settings/data", destination: "/settings/privacy", permanent: true },
  ],
};

export default nextConfig;
