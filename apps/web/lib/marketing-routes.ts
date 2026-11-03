// The public marketing pages (app/(marketing)): the AppShell lets them through without a session and without its frame,
// and the sitemap lists them. Everything else is the signed-in app.

/** Every public marketing page, in the order the sitemap lists them. */
export const MARKETING_PATHS = ["/", "/pricing", "/security", "/updates", "/request-access", "/privacy", "/terms"] as const;

/** True for a marketing page: an exact match, so /pricing/anything stays in the app's hands. */
export function isMarketingPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (MARKETING_PATHS as readonly string[]).includes(path);
}
