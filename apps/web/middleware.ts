// Enforces the Content Security Policy with a per-request nonce. Next reads the nonce from the request's CSP
// header and puts it on its own scripts; app/layout.tsx reads x-nonce for next-themes' inline script. Because the
// nonce changes on every request, pages are rendered per request (the layout reads headers()).

import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, makeNonce } from "@/lib/csp";

export function middleware(request: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production", process.env.NEXT_PUBLIC_SUPABASE_URL);

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Document requests only: not the API routes (JSON), Next's own static files, the files in public/ and the
  // generated ones (manifest, robots, sitemap, icons), or soft-navigation (RSC) fetches, which carry no HTML to put a
  // nonce on. Named by path, never by a file-like ending: a dynamic page such as /inbox/<id> accepts any segment, so
  // excluding "*.pdf" would have served that page with no policy at all (security audit 2026-11-04). Keep this list and
  // lib/csp.ts STATIC_PATHS the same; csp.test.ts checks them against each other.
  matcher: [
    {
      source: "/((?!api/|_next/static/|_next/image|favicon\\.ico$|manifest\\.webmanifest$|robots\\.txt$|sitemap\\.xml$|og\\.png$|sw\\.js$|sw-rules\\.js$|icon\\.svg$|icon-192\\.png$|icon-512\\.png$|icon-maskable-192\\.png$|icon-maskable-512\\.png$|apple-touch-icon\\.png$|demo/|logos/|voices/).*)",
      missing: [
        { type: "header", key: "rsc" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
