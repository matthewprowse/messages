import type { NextConfig } from "next";

// The Content Security Policy is set per request in middleware.ts (it needs a fresh nonce for each page).

// Safe defaults for every page.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  headers: async () => [
    { source: "/:path*", headers: securityHeaders },
    {
      source: "/sw.js",
      headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
    },
  ],
  // The Summary page was at /briefing until 27 October 2026; old links and bookmarks still land on it.
  redirects: async () => [
    { source: "/briefing", destination: "/summary", permanent: true },
    { source: "/briefing/:id", destination: "/summary/:id", permanent: true },
  ],
};

export default nextConfig;
