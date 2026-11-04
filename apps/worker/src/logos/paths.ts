// Names of company logo files, for the logo pipeline and the move to the public bucket (public.ts). Pure. The web app
// tells the buckets apart by the same rule (apps/web/lib/logo-paths.ts).

import { createHash } from "node:crypto";

/** Private: the owner's review files under review/<key>/, and chosen logos saved before the public bucket. */
export const LOGOS_BUCKET = "logos";
/** Public: chosen logos under content-addressed names (supabase/migrations/20261124100000_public_company_logos.sql). */
export const PUBLIC_LOGOS_BUCKET = "company-logos";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** The domain's name in the buckets: its SHA-256, so file names do not list the companies people hear from. */
export const logoKey = (domain: string) => sha256(domain);
/** Where a domain's chosen logo was kept in the private bucket, before the public one. */
export const privateLogoPath = (domain: string) => `${logoKey(domain)}.png`;
/**
 * Where a chosen logo is kept in the public bucket: named for its domain and its content, so a new logo gets a new
 * address (nothing cached for a year goes stale) and the address cannot be worked out from a domain alone.
 */
export const publicLogoPath = (domain: string, png: Buffer) => `${logoKey(domain)}-${sha256(png).slice(0, 16)}.png`;

/** Whether a chosen logo's path is in the public bucket. */
export const isPublicLogoPath = (path: string) => /^[0-9a-f]{64}-[0-9a-f]{16}\.png$/.test(path);
