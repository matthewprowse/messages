// The public site's address and the facts its pages, metadata and structured data share, so a price or the
// address changes in one place.

/** The site's origin with no trailing slash. NEXT_PUBLIC_SITE_URL is set once the domain is bought. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export const SITE_NAME = "Konva";

/** The line search results and link previews show under the name. */
export const SITE_DESCRIPTION = "Konva is the client inbox for South African agents, brokers, attorneys and recruiters: WhatsApp, email and DMs gathered by client, the ones waiting on you first, and replies drafted in your own voice.";

/**
 * Prices in rand a month, excluding VAT (docs/PLAN.md, Business Model). The yearly ones are the monthly equivalent
 * when paid a year at a time, about 20% less.
 */
export const PRICES = { individual: 349, seat: 499, individualYearly: 279, seatYearly: 399, minSeats: 5 } as const;
