# Marketing Site (3 November 2026)

The build spec for the public Konva website. The agreed decisions are recorded in `docs/PLAN.md` under Marketing Site.

## What the Site Is For

Early on, ads are not where customers come from. The Marketing Plan sells to principals through pilots, demos and
referrals. So the site's first jobs are:

1. **Back up the pitch.** A principal hears about Konva on LinkedIn or WhatsApp, then googles it. The site has to make
   Konva look real, safe and made for their office within about 30 seconds.
2. **Book demos and pilots.** One clear action: Request Access (closed beta), with teams asked for their office size so a demo can follow.
3. **Pass Google, Microsoft and Meta verification.** Google OAuth verification and Meta App Review both need a public home
   page on our own domain that says what the app does, plus a Privacy Policy and Terms on that domain. This is the
   hard reason to ship a small site before launch, not after.
4. **Grow search traffic over time.** Sector pages, integration pages and guides bring people who search for the problem.

## Where It Lives

Recommended: inside `apps/web`, served on the main domain (`konva.co.za` or similar), with the app staying at `/inbox`.

- It can render the real app components (thread rows, chat bubbles, the summary strip, labels) with made up demo data, so
  the product pictures are the product: the same as how Linear shows live UI rather than mockups. Nothing is redrawn and it
  never drifts from the app.
- Same tokens (`globals.css`), Geist, shadcn primitives and `Logo`, so the site matches the app by construction.
- One domain keeps search authority in one place, and `/login` is one click away.

What it needs: the root layout currently wraps every page in `AuthProvider`, `AppProvider` and `AppShell`, and `/`
redirects to `/inbox`. Marketing pages need their own layout without those, fully static (no auth, no Supabase on load).
The clean way is two route groups, `(marketing)` and `(app)`, each with its own layout. That moves the app routes into
`(app)`, so do it on a clean tree, not alongside the current uncommitted changes.

The alternative, a separate `apps/site`, needs a shared `packages/ui` for the components and tokens first. More work for no
gain at this size.

## Design: Linear's Structure, Konva's Look

What to take from Linear (structure, from Mobbin): a short nav (Product, Sectors, Pricing, Changelog, Log In, Request Access);
a big tight headline with a muted line under it and the product right below the fold; features shown as real UI in a frame,
each with a two word title and a sentence; a hairline grid of small feature cards ("Built for speed" style); a public changelog; a plain footer with many links.

What stays Konva's: the app's neutral oklch palette, Geist, the `--radius`, the shadcn Button, Card, Badge, Tabs, Accordion
and Input as they are, the channel colours (`--whatsapp`, `--email`) and priority colours as the only colour on the page.
No gradients, glows, 3D or illustration packs the app does not have. Motion is limited to what the app already does.

Rules carried over: Title Case labels and headings, no em or en dashes, dialogs without the X.

## Pages

### Version 1 (small: get the design right)

| Page | Purpose |
| --- | --- |
| `/` Home | Hero with the real inbox, Every Client in One Place, Drafts in Your Voice, Never Miss a Lead (triage and the brief), Your Office Keeps the Clients (teams), Privacy, a sector strip, FAQ, Request Access |
| `/pricing` | Individual and Team, in rand, excluding VAT, with FAQ |
| `/security` | Per user encryption, POPIA, where data lives, what AI sees. Honest wording only (see Copy Rules) |
| `/request-access` | Request Access form, writing to the existing `waitlist` table so Admin keeps working |
| `/updates` | The public changelog: entries published from the Updates tab in Admin, newest first |
| `/privacy`, `/terms` | Needed for verification |

### Version 2 (move quickly once the design is right)

- The other sector pages: insurance brokers and financial advisers, attorneys, recruiters.
- Integration pages: `/integrations/whatsapp`, `/gmail`, `/outlook`, `/linkedin`, `/instagram`, `/calendar`. Each is a real
  page answering "can I use WhatsApp and Gmail in one inbox".
- `/changelog`, published from the owner-only Updates page (already where releases are drafted).
- Comparison pages: Konva vs WhatsApp Business, vs a shared Gmail inbox, vs property CRMs. Fair, factual.
- Guides: lead reply time, POPIA and WhatsApp, running an office's client conversations. Each pilot's before and after reply
  time becomes a customer story.

## Positioning

Kinso's hero is "One inbox, every conversation" and its features (drafts in your tone, a morning brief, search) overlap
ours. Superhuman sells speed in email to enterprise teams. Neither is built around the client or the office, and
neither is made for South Africa. So Konva never leads with "one inbox" or "AI inbox", and says what only it is:

- **Sorted by client, not by app.** One person, one history, across WhatsApp, email and DMs.
- **The office keeps the client.** Client conversations belong to the business; personal chats stay private.
- **Made for South Africa.** WhatsApp first, rand pricing, POPIA, onboarding at hours that suit a working office.
- **The outcome is replying first.** Agents, brokers, attorneys and recruiters win work by speed of reply, not inbox zero.

One line: Konva is the client inbox for South African professionals who win work by replying first. Hero: "Never Keep a
Client Waiting". Competitors are never named on the site; the contrast is one line ("Other AI inboxes help you get
through your messages. Konva helps you keep your clients.").

## Industries

The trade pages were dropped on 3 November 2026: the trades are the Industries section on Home
(`components/marketing/sectors.ts` and `industry-showcase.tsx`), each with its own demo inbox. Separate trade pages
would rank better for searches like "WhatsApp inbox for estate agents", so bring them back as content once pilots give
each trade real proof.

## SEO

Technical, all part of Version 1:

- Every marketing page statically generated. No client JavaScript needed to read the page; product visuals are HTML, so they
  load fast and are readable.
- Next metadata per page: title, description, canonical, Open Graph image generated with `next/og` in the site's style.
- `sitemap.ts` and `robots.ts`. The app routes (`/inbox`, `/settings`, ...) are `noindex` and left out of the sitemap.
- Structured data: Organization, SoftwareApplication with Offers in ZAR, FAQPage on pages with an FAQ, BreadcrumbList on
  sector and integration pages.
- `lang="en-ZA"`. Google Search Console and Bing Webmaster set up on day one.
- Core Web Vitals checked on a phone: most principals will open the link from WhatsApp on mobile.
- Questions answered plainly in text (what Konva is, who it is for, what it costs), which is also what AI search engines
  quote.

Keywords: the targets are the problem in the sector's words ("WhatsApp and email in one place for estate agents", "estate
agent lead response", "POPIA WhatsApp business", "shared WhatsApp for an office"). Search volumes for South Africa are small
and not checked yet: check them in Google Keyword Planner before writing Version 2 pages, and let Search Console data pick
the guides after launch.

## Copy Rules

From the Marketing Plan and safety rules:

- No "we can't read your messages" until Confidential Space is live. Say "encrypted per user, POPIA aligned".
- WhatsApp is not the whole pitch (Baileys can be banned). Sell the one client view across email, WhatsApp and portals.
- No made up numbers, customers or quotes. Proof appears when pilots produce it.
- Drafts in their own voice are the how, not the headline.

## Analytics and Consent

Content free, like the app: page views, which sector page, demo form started and sent. Prefer a cookieless tool (Vercel Web
Analytics) so no cookie banner is needed. No ad pixels until the Meta ad test, and then with consent.

## Decisions (3 November 2026)

1. Domain: bought soon. Until then the site runs on the current host, and the canonical URL comes from `NEXT_PUBLIC_SITE_URL`.
2. Light or dark follows the device.
3. Prices are shown.
4. Closed beta: Request Access, approved in Admin. No open sign up.
5. Privacy Policy and Terms start from a template with placeholders for the registered company.
