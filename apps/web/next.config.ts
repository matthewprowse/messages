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
  headers: async () => [
    { source: "/:path*", headers: securityHeaders },
  ],
  // The Summary page was at /briefing until 27 October 2026; old links and bookmarks still land on it.
  redirects: async () => [
    { source: "/briefing", destination: "/summary", permanent: true },
    { source: "/briefing/:id", destination: "/summary/:id", permanent: true },
  ],
};

export default nextConfig;
