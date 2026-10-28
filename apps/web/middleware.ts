import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, makeNonce } from "@/lib/csp";

// Enforces the Content Security Policy with a per-request nonce. Next reads the nonce from the request's CSP
// header and puts it on its own scripts; app/layout.tsx reads x-nonce for next-themes' inline script. Because the
// nonce changes on every request, pages are rendered per request (the layout reads headers()).
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
  // Pages only: not static files, images, API routes (JSON), the service worker or the manifest.
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff2?)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
