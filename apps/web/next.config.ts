import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Supabase origin from the public env var, in https and wss form (REST, Auth, Storage, Realtime).
function supabaseOrigins(): { http: string; ws: string } | null {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return { http: u.origin, ws: `wss://${u.host}` };
  } catch {
    return null;
  }
}
const sb = supabaseOrigins();
const sbHttp = sb ? [sb.http] : [];
const sbWs = sb ? [sb.ws] : [];

// Content Security Policy. Inline scripts stay allowed because Next injects inline bootstrap/hydration scripts and
// next-themes ships an inline script; tightening that needs per-request nonces from middleware.
// srcDoc iframes inherit this policy, so img-src must allow https: for email images the user chose to load
// (message-body.tsx blocks them by default); the iframe's own sandbox and CSP meta restrict it further.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `connect-src ${["'self'", ...sbHttp, ...sbWs, ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : [])].join(" ")}`,
  `img-src ${["'self'", "data:", "blob:", "https:"].join(" ")}`,
  `media-src ${["'self'", "blob:", ...sbHttp].join(" ")}`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// Report-only: violations are logged to the browser console but nothing is blocked. After browsing the app
// (inbox, email bodies, PDFs, audio/video, realtime, sign-in) with no violations, change the key below to
// "Content-Security-Policy" to enforce.
const cspHeader = { key: "Content-Security-Policy-Report-Only", value: csp };

// Safe defaults for every page.
const securityHeaders = [
  cspHeader,
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
};

export default nextConfig;
