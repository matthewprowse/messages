// Which bucket a company logo path (organizations.logo_path, company_logos.path) lives in. Chosen logos are saved in
// the public "company-logos" bucket under a content-addressed name, so one address per picture is cached for a year;
// logos saved before that stay in the private "logos" bucket, signed as before, until the worker moves them. Pure; the
// worker writes the same names (apps/worker/src/logos/paths.ts).

/** Public brand images, served at one stable address each (supabase/migrations/20261124100000_public_company_logos.sql). */
export const PUBLIC_LOGOS_BUCKET = "company-logos";
/** Older chosen logos, and the owner's review files under review/, which stay owner-only. */
export const PRIVATE_LOGOS_BUCKET = "logos";

/** <SHA-256 of the domain>-<first 16 hex of the PNG's SHA-256>.png */
const PUBLIC_NAME = /^[0-9a-f]{64}-[0-9a-f]{16}\.png$/;

/** Whether a logo path names a file in the public bucket. Anything else is signed from the private one. */
export const isPublicLogo = (path: string) => PUBLIC_NAME.test(path);
