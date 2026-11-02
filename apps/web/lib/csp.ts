// The Content Security Policy, built per request by middleware.ts so each page's scripts carry a fresh nonce.
// srcDoc iframes inherit this policy, so img-src must allow https: for email images the user chose to load
// (message-body.tsx blocks them by default); the iframe's own sandbox and CSP meta restrict it further.
// Review 2026-11-02 M7 asked to drop https:. It cannot be scoped to the frame: a srcdoc frame is checked against this
// header AND its own meta, so narrowing here would block the images the user chose to load, and they come straight
// from the sender's hosts (no image proxy). Everything else in the app loads images from 'self', data:, blob: or
// Supabase signed URLs. Closing the gap fully means serving the email frame from its own route with its own header,
// or proxying images; until then the wide rule stays, and nothing else may widen it (see csp.test.ts).

/** Supabase origin in https and wss form (REST, Auth, Storage, Realtime), from the public env var. */
function supabaseOrigins(supabaseUrl: string | undefined): { http: string[]; ws: string[] } {
  try {
    const u = new URL(supabaseUrl ?? "");
    return { http: [u.origin], ws: [`wss://${u.host}`] };
  } catch {
    return { http: [], ws: [] };
  }
}

export function buildCsp(nonce: string, isDev: boolean, supabaseUrl: string | undefined): string {
  const sb = supabaseOrigins(supabaseUrl);
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonce-carrying Next bootstrap load its own chunks; 'self' is the fallback for old browsers. unsafe-eval is for the dev server's hot reload only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `connect-src ${["'self'", ...sb.http, ...sb.ws, ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : [])].join(" ")}`,
    `img-src ${["'self'", "data:", "blob:", "https:"].join(" ")}`,
    `media-src ${["'self'", "blob:", ...sb.http].join(" ")}`,
    "worker-src 'self' blob:",
    // Styles stay inline: React style attributes and the toast library set them, and they cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** A fresh random nonce: 128 bits, base64. */
export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
