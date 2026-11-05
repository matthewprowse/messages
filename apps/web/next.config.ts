// Next.js config for the web app: the security and cache headers, and the redirects for old addresses. The Content
// Security Policy is not here; middleware.ts sets it per request because it needs a fresh nonce for each page.

import type { NextConfig } from "next";

// Safe defaults for every page.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Voice notes need the microphone, so it stays allowed for this site.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), microphone=(self)" },
  // A page from another site that opens this one gets no handle on it. "allow-popups" because the OneDrive picker
  // (lib/cloud-pick/onedrive.ts) is a popup this page opens and keeps talking to: with "same-origin" the popup's move to
  // Microsoft's sign-in cuts it off. The app's other popups and links open with noopener. Provider connects are redirects.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The browser tests build into their own folder (.next-e2e, e2e/support/serve.ts), so a test build never touches the
  // .next that the dev server on localhost:3000 is using. Such a build reads tsconfig.e2e.json, which already lists the
  // folder's types, so Next has no reason to rewrite tsconfig.json; pnpm typecheck checks the types, so the build does not.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  ...(process.env.NEXT_DIST_DIR ? { typescript: { tsconfigPath: "tsconfig.e2e.json", ignoreBuildErrors: true } } : {}),
  poweredByHeader: false,
  // Pages are driven from the in-memory store, so a cached page payload carries no data: keep visited pages for 30 s
  // in the router cache instead of fetching them from the server on every rail click.
  experimental: { staleTimes: { dynamic: 30 } },
  headers: async () => [
    { source: "/:path*", headers: securityHeaders },
    // The OneDrive sign-in comes back here inside the picker popup, from Microsoft's site. Any COOP on this page would put
    // it in a new browsing context group and lose window.opener, so this one page opts out (the later rule wins). It only
    // posts the code to this origin and shows nothing.
    { source: "/attachments/onedrive-callback", headers: [{ key: "Cross-Origin-Opener-Policy", value: "unsafe-none" }] },
    // Voice samples and provider logos rarely change; a day in the cache, a week of serving stale while it refreshes.
    { source: "/voices/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    { source: "/logos/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    // The app icons are linked with ?v= (app/manifest.ts, app/layout.tsx, public/sw.js) and the demo avatars never change,
    // so a year, immutable. Change the ?v= (or a demo file's name) when one is redrawn. sw.js, sw-rules.js and the
    // manifest stay on the default revalidation, or a new service worker could never reach anyone.
    ...["/icon-:name.png", "/icon.svg", "/apple-touch-icon.png", "/demo/:path*"].map((source) => ({ source, headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] })),
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
    // Old addresses that were pages calling redirect() (a 307); answered here, they need no server function.
    { source: "/whats-new", destination: "/settings/whats-new", permanent: false },
    { source: "/contacts/companies", destination: "/contacts?view=companies", permanent: false },
    ...["voice", "exports", "activity", "work-chats"].map((view) => ({ source: `/settings/team/${view}`, destination: `/settings/team?view=${view}`, permanent: false })),
  ],
};

export default nextConfig;
