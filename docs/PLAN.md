# Product Plan

What we have agreed on so far: who Messages is for, what is in the MVP, how the key features work and
what comes later. Update this file whenever a decision changes.

The product is called Konva (decided 24 October 2026). The code and this plan still say Messages.

## Who It Is For

Anyone anywhere can sign up, but marketing targets South African professionals whose income depends
on replying to clients quickly:

1. Estate agents (first)
2. Insurance brokers and financial advisers
3. Attorneys
4. Recruiters

Their clients reach them on WhatsApp, email and Instagram at once. Kinso sorts messages by channel for
busy founders. Messages sorts them by client for professionals who cannot afford to lose one.

Positioning lines to test:

- Every client conversation, in one place.
- Never lose a client on WhatsApp again.
- Your clients message you everywhere. Answer them in one place.

## Business Model

- Individual: R349 a month. Team seat: R499 a month, with a minimum of 5 seats. Paid yearly, about 20% less: R279 and
  R399 a month (agreed 3 November 2026). Prices exclude VAT
  (register once turnover passes R1M in 12 months).
- Sell whole agencies, practices and brokerages, not only single seats. The owner keeps the client
  history when an agent leaves.
- Ideal customer (26 October 2026): a business in any industry where speed of response wins work,
  onboarding 5 to 25 team members at once. Individual sign-ups are the side door, not the plan.
- Goal: more than R1M a month in profit within 12 months. That needs about 3,800 paying users by
  month 12. At the researched cost of getting a user (about R1,200), that takes over R5M of marketing
  in the year unless agency deals bring most users, so treat it as a stretch, not the base case.

### Revenue Estimates (October 2026)

Ranges from a simulation over the inputs below (20,000 runs). P50 is the middle outcome; P10 and P90
are the bad and good ends. Figures run from the month paid marketing starts, exclude VAT and exclude
any salary.

| Input | Low | Middle | High | Source |
| --- | --- | --- | --- | --- |
| Meta cost per click | R3.50 | R6 | R10 | Superads benchmarks: South Africa about $0.22, real estate about $0.35, at about R16.50 to the dollar |
| Clicks that start a trial | 1.5% | 4% | 8% | Typical B2B landing pages, lower because accounts must be connected |
| Trials that pay (no card asked) | 6% | 12% | 20% | First Page Sage 18% for no-card trials, ChartMogul median 8% |
| So, cost per paying user from ads | about R690 | about R1,190 | about R2,170 | Worked out from the three rows above |
| Average income per user | R330 | R390 | R430 | R349 and R499 plans, some annual discounts |
| Cost to run a user | R45 | R70 | R120 | Gemini, hosting, card fees, support; a bottom-up check from the code gives R54, R94 and R129 on the Individual plan, see Cost, Revenue and Profit by User Count below |
| Paying users cancelling each month | 3% | 5% | 8% | SMB SaaS benchmarks 3% to 7% |
| Users from your own selling each month | 5 | 15 | 30 | Assumption |
| Referrals each month, share of users | 1% | 3% | 5% | Assumption |
| Seats from agency deals each month, from month 4 | 0 | 10 | 30 | Assumption |
| Fixed costs | R11k a month, R65k once, plus R15k a month from month 6 for KMS and Confidential Space | | | |

With R495k of marketing in the year:

| After 12 months | P10 | P50 | P90 |
| --- | --- | --- | --- |
| Paying users | 460 | 660 | 960 |
| Monthly revenue in month 12 | R175k | R253k | R368k |
| Revenue in the year | R0.90M | R1.29M | R1.84M |
| Profit in the year | -R86k | R224k | R681k |
| Profit in month 12 | R45k | R104k | R194k |
| Most cash needed at any point | R188k | R130k | R108k |
| First profitable month | 4 | 5 | 9 |

With R1.32M of marketing in the year:

| After 12 months | P10 | P50 | P90 |
| --- | --- | --- | --- |
| Paying users | 830 | 1,310 | 2,090 |
| Monthly revenue in month 12 | R317k | R500k | R802k |
| Revenue in the year | R1.43M | R2.19M | R3.42M |
| Profit in the year | -R501k | R116k | R1.12M |
| Profit in month 12 | R7k | R146k | R373k |
| Most cash needed at any point | R510k | R224k | R126k |
| First profitable month | 5 | 8 | 12 |

Market size in South Africa: about 50,000 property practitioner certificates (PPRA renewal cycle),
about 35,000 practising attorneys (LPC and LSSA), about 168,000 appointed FAIS representatives
(implied by the FSCA's 1,679 debarments being about 1% of them, most tied to banks and insurers),
and about 4,500 to 5,400 recruitment businesses. If 5% to 10% of the independent professionals among
them pay, that is roughly 5,000 to 10,000 users, or R2M to R4M a month in revenue at full maturity.

The three numbers that decide which column we land in are cost per click, clicks that start a
trial, and trials that pay. The first R10k to R15k of ads measures all three. Rerun the model with
the real figures then.

### Five-Year Estimates (October 2026)

Same inputs and 20,000 runs, carried to 60 months, with R50k of starting cash. Ads are paid only
from cash on hand (half of what is free above a R15k buffer). Added: 6% price rise each year, a
market of 5,000 to 12,000 South African payers that gets dearer to reach as it fills, a R25k to
R30k support or sales hire for each 700 users after the first 400, and the yearly Google security
assessment. Fixed costs start lean (R4k a month, R25k once) and rise to R11k at 150 users and add
KMS and Confidential Space at 300. Excludes VAT, tax and the founder's salary. South Africa only.

Bootstrapped on R50k, middle outcome (P10 to P90 in brackets):

| Year | Paying users at year end | Revenue in the year | Profit in the year |
| --- | --- | --- | --- |
| 1 | 470 (320 to 670) | R0.96M (R0.6M to R1.4M) | R0.3M (R0.15M to R0.5M) |
| 2 | 1,080 (760 to 1,510) | R4.0M (R2.8M to R5.7M) | R2.0M (R1.0M to R3.2M) |
| 3 | 1,590 (1,110 to 2,220) | R7.1M (R4.9M to R10.0M) | R4.1M (R2.6M to R6.2M) |
| 4 | 2,020 (1,400 to 2,830) | R10.1M (R7.0M to R14.2M) | R6.1M (R3.9M to R9.3M) |
| 5 | 2,410 (1,670 to 3,370) | R13.1M (R9.0M to R18.4M) | R8.3M (R5.2M to R12.3M) |

With R1.5M raised in month 12 (spent on ads, a R50k founder salary and one salesperson), year 5
revenue is about R24.7M (R17.6M to R34.1M) with about 4,500 users, and about half of the runs average
R1M a month in profit in year 5. Bootstrapped, 12% do. None reach it in the first 3 years either way.

If own selling, agency deals and referrals come in at about a third of the plan's figures, the
bootstrapped year 5 falls to about R8.0M revenue and 1,500 users, and year 1 to about R0.3M.

What this shows: the R50k is enough because the plan's own selling and agency deals bring most early
users for free, so those two numbers matter more than the ad budget. The ceiling is the South
African market, not cash; a raise roughly doubles the outcome, and a bigger raise adds little unless
it pays for selling outside South Africa. The model assumes the product sells and WhatsApp keeps
working; it does not price in a Baileys ban wave or a Google verification delay.

### Cost, Revenue and Profit by User Count (27 October 2026)

A bottom-up check of the plan's cost-to-run row, using the audit of the code. Estimates, not measured: prices of Google Cloud,
Supabase, Vercel and Resend are from memory and need confirming, and the AI split by model is an assumption. R16.50 to the dollar,
excluding VAT, income tax, salaries, marketing and acquisition cost, and hires.

**Per-user inputs.**
- Mix of plans: 73% Individual at R349 and 27% Team seat at R499, which gives R389.50 average income, matching the plan's middle R390.
- Mix of usage: 25% low, 55% medium, 20% high.
- AI cost per user is capped by the AI Budget ($5, R83). Before the Google price change a low, medium and high user costs about R30, R63 and R83. After 1 January 2027, when Gemini 3.8 Flash and the speech models double, low is about R43 and medium and high sit at the R83 cap (medium would be R94 without it).
- Storage R0.40, R2 and R7, card fees R11 (Individual) and R15.50 (Team), support time R5, R10 and R20.
- Blended variable cost per user, before hosting: **R84 now, R99 after the price change**.

**Per user, by plan and usage (cost, then margin).**

| Plan and usage | Cost now | Margin now | Cost after | Margin after |
| --- | --- | --- | --- | --- |
| Individual, low | R54 | R295 (85%) | R67 | R282 (81%) |
| Individual, medium | R94 | R255 (73%) | R114 | R235 (67%) |
| Individual, high | R129 | R220 (63%) | R129 | R220 (63%) |
| Team seat, low | R59 | R440 (88%) | R72 | R427 (86%) |
| Team seat, medium | R99 | R400 (80%) | R119 | R380 (76%) |
| Team seat, high | R134 | R365 (73%) | R134 | R365 (73%) |

Per-user costs here include R8 of hosting, assuming about 300 users. In the totals below hosting is a fixed cost.

**Fixed monthly costs by size.** Built from: one worker VM in Johannesburg (about R500 to R580), disk, the KMS key, network, Supabase
Pro (R410) from 50 users, Vercel Pro (R330) from the first paying user, point-in-time database backups (about R1,650) from 100 users,
Resend Pro (R330) from 250 users, Confidential Space VMs (about R1,400 each) from 300 users, larger Supabase compute from 500 users,
and one extra VM per 500 to 1,000 users after that. It also includes **R2,500 a month as a placeholder** for the yearly Google
CASA security assessment, which has no quote yet and gates launch.

| Users | Fixed cost a month |
| --- | --- |
| 10 | R3,570 |
| 50 | R3,980 |
| 100 | R5,680 |
| 250 | R6,050 |
| 500 | R8,470 |
| 1,000 | R11,730 |
| 2,500 | R18,670 |
| 5,000 | R32,120 |

**Totals a month, before and after the Google price change (27 October 2026 assumptions).**

| Users | Revenue | Variable cost now | Fixed | Profit now | Margin now | Profit after | Margin after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | R3,895 | R843 | R3,570 | -R518 | loss | -R661 | loss |
| 50 | R19,475 | R4,215 | R3,980 | R11,280 | 58% | R10,565 | 54% |
| 100 | R38,950 | R8,430 | R5,680 | R24,840 | 64% | R23,410 | 60% |
| 250 | R97,375 | R21,075 | R6,050 | R70,250 | 72% | R66,675 | 69% |
| 500 | R194,750 | R42,150 | R8,470 | R144,130 | 74% | R136,980 | 70% |
| 1,000 | R389,500 | R84,300 | R11,730 | R293,470 | 75% | R279,170 | 72% |
| 2,500 | R973,750 | R210,750 | R18,670 | R744,330 | 76% | R708,580 | 73% |
| 5,000 | R1,947,500 | R421,500 | R32,120 | R1,493,880 | 77% | R1,422,380 | 73% |

"After" variable cost is R98,600 for 1,000 users and scales the same way (R99 a user).

**What this shows.**
- Break-even is about 12 to 13 paying users, at the start-up fixed cost of R3,570 to R3,980.
- The R1M a month profit goal needs about 3,400 users at today's prices and about 3,600 after the price change, a little under the
  plan's 3,800 because fixed costs are lower here than the plan assumed. The plan's marketing, hires and salary are still to come off.
- The Google price change takes 3 to 4 points off the margin at scale, and about R70,000 a month at 5,000 users.
- The cap is what protects margin. If you raise the AI cap to $7.50 to keep medium and high users' service unchanged after the
  price change, the blended variable cost rises by about R20 a user.
- Not in these numbers: the plan's support or sales hire for each 700 users after the first 400 (R25k to R30k each; support time per
  user is already counted), marketing, cost to acquire a user (R1,190 in the middle), and VAT once turnover passes R1M in 12 months.
- Weak points: the CASA placeholder, how many users one VM and one database really carry, and the AI split by model. Replace
  these with measured figures after the first month of real usage.

### UK and US (October 2026)

Working assumptions, not yet tested: UK at £29 individual and £39 a seat, US at $39 and $49 (about
R700 a user either way, at R22 to the pound and R16.50 to the dollar). Meta clicks cost about R20 in
the UK and R23 in the US, against R6 here, and trials convert a little worse (no local references).
That puts the cost of a paying user at about R5,000 to R6,000, so ads take about 8 months to pay back,
against about 3 in South Africa. There is no own selling abroad and few agency deals. Payments go
through a merchant of record (about 6%), which handles UK VAT and US sales tax.

| Bootstrapped on R50k, middle outcome | Year 5 revenue | 5-year revenue | Year 5 users (SA / UK / US) | Year 5 runs averaging R1M+ profit a month |
| --- | --- | --- | --- | --- |
| South Africa only | R13.0M | R35M | 2,410 / 0 / 0 | 12% |
| UK from month 13 | R16.4M | R42M | 2,350 / 390 / 0 | 33% |
| UK from month 13, US from month 25 | R18.7M | R46M | 2,410 / 400 / 200 | 45% |
| All three from month 1 | R20.0M | R50M | 2,400 / 450 / 280 | 54% |
| R1.5M raised in month 12, UK month 13, US month 25 | R40.1M | R98M | 4,470 / 1,030 / 570 | 85% |

All three from month 1 looks best on paper, but every run runs out of cash in the first months
(about R40k short), year 1 profit halves, and it needs support across three time zones on part-time
hours. The order: South Africa first, the UK once South Africa has 300 to 500 paying users, the US
only with funding or a WhatsApp-heavy niche.

- UK: WhatsApp is used for clients, English, close time zone, and FCA record-keeping rules make the
  client archive easy to sell to advisers and mortgage brokers. Host in a UK or EU region for UK GDPR.
- US: most clients text by SMS or iMessage, which Konva cannot read, so target WhatsApp-heavy niches
  (agents serving Latino and international buyers, immigration attorneys, international recruiters).
- Regulated buyers abroad (advisers, brokers) will expect the official WhatsApp Business API rather
  than Baileys, and they already have archiving vendors to choose from.
- Run a small UK ad test (R5k to R10k to a waitlist) alongside the South African one to measure UK
  click costs and sign-ups before committing.

South Africa and the UK only, UK from month 13, middle outcome:

| Year | Bootstrapped revenue | Bootstrapped profit | Users (SA / UK) | With R1.5M in month 12: revenue | Profit | Users (SA / UK) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | R0.96M | R0.3M | 470 / 0 | R1.0M | R0.14M | 570 / 0 |
| 2 | R4.3M | R1.9M | 1,060 / 80 | R8.4M | R1.4M | 2,080 / 240 |
| 3 | R8.2M | R4.6M | 1,550 / 170 | R17.5M | R7.3M | 3,080 / 480 |
| 4 | R12.2M | R7.3M | 1,970 / 280 | R25.7M | R12.5M | 3,790 / 730 |
| 5 | R16.4M | R10.3M | 2,350 / 390 | R33.6M | R17.6M | 4,360 / 990 |

When the UK starts barely matters while it grows only from ads (5-year revenue is R42M to R43M
whether it starts in month 1, 7 or 13), so start it once South Africa runs smoothly. Leaving out the
US costs about R2M of year 5 revenue bootstrapped and about R6M funded.

### Launch Model: South Africa, Team Deals First (October 2026)

Decided 26 October 2026: launch in South Africa only (a UK user costs about 4 to 8 times as much to
win, per the UK figures above), sell mainly to businesses that onboard 5 to 25 seats at once, and keep
individual sign-ups from ads as a side channel. Plan: R75k over the first 4 months, paying costs first
and the rest on individual ads (up to R30k a month); the first Google check is paid before launch.
Interactive model with sliders and sources: https://claude.ai/artifact/3uKxGHoQezWJcaTK9uavc5

Team inputs and their sources: demos a month (yours: 4 to 16); demos that close (18.7% median across
B2B demos, 32% for small-business demos, 40% top performers; Visionary Marketing, Fungies); seats per
new business (yours: 5 to 20); businesses cancelling (0.9% to 1.8% a month, from 80% to 90% yearly
gross retention for small-business SaaS; StealthAgents, SaaS Capital); seat growth in businesses that
stay (0% to 20% a year; Aleph and Benchmarkit, Statisfy); an optional salesperson at about 27 demos a
month (Crunchbase) and R18k to R46k a month (Paylab SA). Individual inputs are the sourced ad, trial
and churn figures from before. Support staff and rising click costs are included. Demo close rates,
cancellations and seat growth move together with the ad numbers at 50% (an estimate).

The model runs 1,000 random mixes of the ranges and shows the runs at the 10th, 50th and 90th place
by revenue. Monthly revenue (P10 / P50 / P90):

| | You alone, 8 demos a month | With a salesperson from month 6 |
| --- | --- | --- |
| Month 12 | R131k / R212k / R344k | R279k / R415k / R673k |
| Month 24 | R264k / R412k / R676k | R708k / R1.10M / R1.68M |
| Month 36 | R359k / R572k / R948k | R1.02M / R1.67M / R2.54M |
| Month 60 | R539k / R869k / R1.48M | R1.58M / R2.59M / R4.28M |

Team deals bring 80% to 95% of revenue in most runs. With a salesperson from month 6, the middle run
reaches about R1M a month in profit around month 36 (excluding your salary and tax). What the model
assumes and cannot check: that you can fill 8 qualified demos a month (finding people to demo to is
not costed), that a new product closes like established ones, and that businesses accept WhatsApp
through Baileys. Your first 10 to 20 demos give a real close rate and seats per business.

### Marketing Plan (2 November 2026)

Konva is sold to estate agency offices, not advertised to consumers. One 15 agent office is about R7,500 a month, the
same as about 20 individual sign-ups from ads, so selling, referrals and proof come before ad spend.

Message:

- To agents: "Reply to every lead in minutes, even during a show day." Drafts in their own voice are how, not the headline.
- To principals, who buy: "When an agent leaves, the clients stay with the office" and "See which leads are waiting for a reply."
- Proof over claims: measure each office's average lead reply time before and after Konva and use it in every pitch.
- No "we can't read your messages" until Confidential Space is live. Until then: encrypted per user, POPIA aligned.
- Do not make WhatsApp the whole pitch (Baileys can be banned). Sell the one client view across email, WhatsApp and portals.

Channels, in order:

1. Pilot offices, months 1 to 3: 10 franchise offices with 5 to 25 agents (RE/MAX, Seeff, Pam Golding, Chas Everitt,
   Harcourts franchises, where the principal decides). Reach principals on LinkedIn and WhatsApp. 30 days free with the
   founder setting the office up, in return for before and after reply times and a usable quote.
2. 15 minute demos at agencies' weekly sales meetings, using leave days or early slots.
3. Referrals in the product: a free month for both sides when a referral pays. Agents moving offices carry Konva with them.
4. Industry presence: SA agent Facebook groups and WhatsApp communities, IEASA, CPD events. Short clips, not pitches.
5. Founder content 2 to 3 times a week: LinkedIn for principals, Instagram or TikTok reels for agents, built in public.
6. Paid ads only after the pilots: the R10k to R15k Meta test aimed at agents with the case study figures. Scale only if
   cost per click, clicks that start a trial and trials that pay beat the middle column above.
7. Year 2: franchise head office deals, property CRM partnerships, then brokers and financial advisers (compliance archive).

Target: about 15 principal conversations a month, 5 demos, 1 to 2 offices signed. Ten offices by month 6 is about 150
seats, or R75k a month, which is enough to prove the model and run the ad test properly.

Start Google verification and the CASA assessment before marketing: until it passes, pilot offices count against the
Gmail test user cap.

### Marketing Site (3 November 2026)

A small public site comes back now, mainly to back up the pitch to principals, take access requests and give Google and
Meta verification a home page, Privacy Policy and Terms on our own domain. The full proposal and build spec is
`docs/MARKETING-SITE.md`. Agreed 3 November 2026:

- Linear's structure (from Mobbin), the app's look: same tokens, Geist, stock shadcn and the real app components with
  made up demo data as the product pictures.
- It lives in `apps/web` as the `(marketing)` route group on the main domain, with the app at `/inbox`. The domain is
  bought soon; until then it runs on the current host.
- Light or dark follows the device, like the app.
- Prices are shown (R349 Individual, R499 a Team seat with 5 at least, excluding VAT).
- Closed beta: the call to action is Request Access (approved in Admin), not open sign up.
- Privacy Policy and Terms start from a template with placeholders for the registered company's details.
- Version 1 is small: Home, Estate Agents, Pricing, Security, Request Access, Privacy, Terms. Get the design right first.
- Built for review (3 November 2026): all of Version 1 plus the other three trade pages (Brokers and Advisers,
  Attorneys, Recruiters) from one template, each with its own demo inbox. No mono label eyebrows and no arrows on
  buttons. Mockups use made up initials avatars and company marks (`public/demo`). Phones get a full screen menu.
  Pricing lists what each plan includes plus a full comparison table. Request Access writes to `waitlist` again.
- Second review (3 November 2026): two main pages, Home and Request Access, with Pricing and Security kept as their own
  pages and Privacy and Terms for the law. The trade pages are dropped and become the Industries section on Home (a
  list on the left, each trade's pitch and inbox on the right, moving on by itself). Headings are centred. No border
  under the header. A big Konva wordmark in the footer. Motion: the hero inbox drafts a reply and new leads land, the
  apps run past as a marquee, sections rise in on scroll. The features are a bento of cards with small pictures, not
  a grid of text. "When someone leaves" is folded into the Why Konva pillars, not its own section.
- Positioning (3 November 2026): Kinso's hero is "One inbox, every conversation", so Konva does not lead with one
  inbox. Konva is the client inbox for South African professionals who win work by replying first: sorted by client,
  owned by the office, made for South Africa. Hero: "Never Keep a Client Waiting". Competitors are not named on the
  site. See docs/MARKETING-SITE.md, Positioning.
- Suppliers (Google, Supabase, Vercel) are named only in the Privacy Policy, where the law asks for them, not on the
  marketing pages.
- Updates (3 November 2026): a public changelog at `/updates`, in the header and footer. It shows the entries the owner
  publishes from the Updates tab in Admin (`public.updates`), newest release first, each with its date and version beside
  it. The server reads published rows only, with the service role, cached for five minutes; drafts never leave the
  database and no new read policy was needed. The old owner-only `/updates` route is gone (the editor is in Admin).
  Publishing an entry now makes it public, so write each one for clients.

### Founder Hours and Support (2 November 2026)

The founder works a 9 to 5 in 2027 and plans to go full time once monthly revenue covers about six months of costs with
steady growth. Check the employment contract for side business and IP clauses before launch.

- Onboarding is self serve by default (see Onboarding below). Live calls are a perk for teams and anyone stuck, not a step.
- One group onboarding session a week on a weekday evening, about 30 minutes, for everyone who signed up that week.
- One to one calls are booked through a link with a cap of about 5 a week.
- A short recorded walkthrough for people who never join a session.
- Weekly hours: two weekday mornings 6:30 to 8 (building, one call), two weekday evenings 6 to 8 (outreach, content,
  support, one is the group session), Saturday (office visits, demos, building). Sunday is off.
- Clients are told plainly: "Onboarding calls are early mornings, evenings and Saturdays, so they don't eat into your
  working day" and "We reply within one working day." Support is checked at lunch and in the evening.
- Track onboarding steps in the content free analytics (connected, first draft seen, first send) to find where people drop.

## Fair Usage and Storage

Storage: 20 GB per seat approved 27 October 2026. Built so far: the Storage section in Settings, Usage,
and the Storage Flags table in owner analytics (migration `20261031130000_storage_usage.sql`, needs applying).
Not built yet: the cap itself (stopping new files at 100%) and the 80% email. The other open questions
below are still to decide. AI fair usage is proposed at the end of this section and not approved.

**The problem.** Konva stores every attachment it syncs in the private attachments bucket. Today the only
limit is 50 MB a file. Someone could WhatsApp themselves video and archives all day and use Konva as free
file hosting. Each file has its size recorded (`attachments.size_bytes`), so usage per person is
measurable already; only the rules and the meter are missing.

**What counts.** Pictures, video, PDFs and other documents kept in the bucket, plus files attached to
notes and sent from Konva. Voice notes and stickers are not part of Attachments (decided 27 October
2026): they stay in their chats, are not listed on the Attachments page and do not count toward the cap.
Nor does text, inline images, tiny images, files from Junk (those are not kept) or anything a person deleted.

**Proposed cap.** 20 GB included per paid seat. Team plans pool it across seats (5 seats share 100 GB),
so one heavy user does not trip a limit while the agency has room. Storage costs about R0.35 per GB a
month, so 20 GB is under R7 against R349 income and does not eat into the R70 to R120 cost to run a user.
The cap is for abuse and runaway cases, not for normal use; most people should never see it.

**What happens as it fills.**

| Used | What the person sees | What happens |
| --- | --- | --- |
| Under 80% | Nothing | Everything is kept |
| 80% | A notice in Settings and one email | Everything is kept |
| 100% | A banner on Attachments, with what is using the space | New files stop being saved. Messages still sync and show; the file shows "Not Kept Here" with the original left in Gmail, WhatsApp or the mailbox |
| Over 100% for 30 days | A second email | Same as above. Nothing is ever deleted by us |

Files already stored are never removed because of the cap. Deleting files frees space, and saving
resumes on its own.

**Limits that stay on.**
- 50 MB a file stays (Supabase's default upload limit).
- Same file, same account: store once, by content hash, so forwarding the same PDF costs one copy. (Built: `file-store.ts` keeps a keyed `content_hash` and points a repeat at the stored object, so several attachment rows can share one `storage_path`. Any delete feature must count references by `storage_path` before removing an object.)
- Not built yet: Videos over a size to be set (suggest 25 MB) are kept as a link to the original, not copied, since
  video is where almost all the bytes go.

**Spotting abuse.** A clear sign is a WhatsApp chat with your own number, or a chat with one other person,
that is mostly large files. Flag an account when over half its stored bytes come from its own chat, or it
adds more than 5 GB in a week. A flag only shows the account to the owner in the analytics page; nothing
is blocked automatically.

**The meter (Settings, Storage).** Total used and the cap, then a split by Images, PDFs, Voice Notes,
Video and Files, each with a count and size, then the ten biggest files with a Delete button. The
Attachments page gets no counts in the grid; the numbers live in Settings.

**Fair usage wording, for the terms of use.** "Konva keeps your attachments so you can search and find
them. It is not file storage. Each seat includes 20 GB of attachments; we may stop saving new files above
that, or ask you to remove files, if use is far beyond normal. We will tell you first and never delete
your files without asking."

**Build size (Claude-built).** About one day: a per-user size total (a view or a function), the check in
the sync worker and the AI worker before saving a file, the Settings page, and the two emails.

**To decide before building.**
1. Is 20 GB per seat right, or higher or lower?
2. Should videos over 25 MB be kept as links, or stored up to 50 MB like everything else?
3. Hard stop at 100%, or a grace allowance (say 10%) so a sync never fails midway through a thread?
4. Do the Individual and Team plans share the same per-seat amount?
5. Should a paid add-on (extra 100 GB) exist later, or is the cap simply a ceiling?

### AI Fair Usage

**Decided 27 October 2026** (this replaces the allowance table and the 300% rule further down):
- One maximum per seat per month, starting at $5, set and changed in the Admin page (AI Budget), not in code.
- That maximum is divided into a share for each feature, also set in Admin. Starting split: Sorting and
  Junk 30%, Drafts 35%, Learning From Edits 10%, Daily Brief 10%, Transcripts 15%. Shares add up to 100%, so the
  total can never pass the maximum.
- When a person has spent their share of a feature, that feature pauses for them until the 1st (UTC).
  For Drafts that means automatic drafting stops. Other features carry on.
- People see a percentage, like Claude's usage: how much of the month's allowance is left, and how much of
  each feature is used. Never dollars. Dollars stay in owner analytics.
- Company logos are shared by everyone and are not counted against a person.
- **Weekly limit (added 27 October 2026):** features switched on in Admin (starting with Drafts and
  Transcripts) also have a weekly limit, 40% of their monthly share, so a month is not spent in a few days.
  Weeks start on Monday (UTC). Sorting new mail and the Daily Brief have none. Usage shows a bar for the
  week and one for the month, as percentages.
- **Setup allowance (added 27 October 2026):** each newly connected account gets $2 for 7 days for its first
  sort, search index and learning. That work is marked and counted toward neither the week nor the month. Past
  $2 it counts normally. Measured on the owner's mailbox (3,500 messages), a first import costs about $1.20 and
  takes 30 to 45 minutes. The dollar amount, the 7 days, the weekly percent and the weekly features are all set
  in Admin.

- **Per-conversation and per-day limits (added 27 October 2026):** at most 10 drafts a person can ask for in
  one conversation in an hour, 3 automatic drafts per conversation per day, and 50 contact and company summaries
  per person per day (so a large import catches up over a few days). A draft over the limit fails with a plain
  message; an automatic one is dropped quietly.
- **Abuse flag (added 27 October 2026):** an account is flagged in Admin when it uses over $2 in a day (setup
  included) or its month is more than 5 times the middle person's and over $1. A flag blocks nothing.
- **Admin:** AI Usage by Person shows each person's month, week, today and setup spend, calls, split by feature
  and any flag. AI Budget holds every number above and all can be edited there.
- **Fixes (27 October 2026):** the setup allowance counts only accounts that bring in messages (not calendars,
  task lists or reminders). Sorting and learning from before the allowance existed were marked as setup, so the
  owner's first import no longer counts against the month. Contact notes now run on the cheaper model (company
  summaries already did). The Daily Brief is spoken only when someone presses Listen; a refresh or voice change
  re-speaks it, at most 3 times a day.
- Shares now: Sorting and Junk 30%, Drafts 25%, Learning From Edits 20%, Daily Brief 10%, Transcripts 15%.

Built: the `ai_budget` table and the allowance functions (`20261031140000_ai_budget.sql`,
`20261031150000_ai_limits_flags.sql`), the checks in the AI worker, and the Admin and Usage pages.

**Code check (27 October 2026).** The limits exist, but they are weaker than the text above says:
- The allowance check fails open: if the lookup errors, the call goes ahead. The result is cached for 60 seconds
  and usage is written afterwards by a background queue, so parallel calls (triage runs 4 at a time, plus drafts,
  brief and meetings) can overshoot. A meeting is checked per window, so one long recording can spend several
  times its share.
- **The setup allowance can be farmed.** It is $2 for every row in `accounts` created in the last 7 days, and
  `accounts` has an insert-anywhere policy for signed-in users. Anyone can insert rows in a loop and get
  unlimited AI that counts toward no cap. Reconnecting an account also re-grants it. Fix: remove INSERT and
  DELETE on `accounts` from the app role (the web app creates accounts with the service role) and grant the allowance
  once per person per provider address.
- Draft limits (10 an hour, 3 automatic a day) are per conversation only. Compose and new-message drafts are not
  limited. A separate cap of 30 automatic drafts a person a day exists in the database and was not written here.
- The Daily Brief limit of 3 a day is in the database and counts requests. The automatic daily script is not counted.
- Company logos are uncapped, with no maximum number of tries; failures retry forever.
- Timed-out calls are retried up to 4 times and never recorded, so they are billed and not counted.
- The recording and voice note limits are in bytes (500 MB, 15 MB), not minutes.
- Audio is billed as text tokens in `pricing.py`, so voice note and meeting cost is probably understated.
- Prices of Gemini 3.8 Flash and the speech models double on 1 January 2027 (already in `pricing.py`).
- Not built: the first-import cap (the code imports 30 days, no conversation cap), the 20 GB storage cap and its
  80% and 100% behaviour and emails, hash dedupe and the 25 MB video link. Only the meter exists.

The rest of this section is the original proposal.

**The aim.** A normal person never notices a limit. The limit exists for the account that, say, uploads
hours of meeting recordings or regenerates drafts in a loop, and costs more than it pays. It must
not slow the things everyone depends on.

**What is already known.** Every model call is recorded in `ai_usage` with its tokens and its cost in
dollars, per person and per feature (triage, draft, learn, brief, transcribe). Settings, Usage already
shows it. So the limit can be set on cost, which is what actually hurts, not on counts of calls.

**What a limit applies to.** Split the AI work by who starts it:

| Work | Started by | Limited? |
| --- | --- | --- |
| Sorting and Junk (triage) of new mail | Incoming mail | Never. It is bounded by how much mail arrives |
| Daily Brief | A schedule | Never. One a day |
| First draft for a conversation that needs a reply | Incoming mail | Never, within the per-thread rule below |
| Regenerating or re-prompting a draft, voice-instructed drafts | The person | Yes |
| Learning from edits | The person's edits | Never. Small |
| Voice note transcripts | Incoming voice notes | Yes, by length |
| Meeting recordings and transcripts (up to 500 MB each) | Meetings that end | Yes. This is the biggest cost per item |
| Reading aloud (speech), Google Search grounding | The person | Yes |

**The allowance.** A monthly AI allowance per seat, worked out from `cost_usd` already recorded, reset on the
first of the month (UTC, as the Usage page groups months). Start at $5 a seat (about R83, under a quarter of
the R349 price) and then set it at five times the middle paying user's real AI cost once a month of real
data exists. Teams pool it across seats, as storage does.

**What happens as it fills.**

| Used | What the person sees | What happens |
| --- | --- | --- |
| Under 80% | Nothing | Everything works |
| 80% | A line on Settings, Usage ("AI allowance: 80% used, resets on the 1st") | Everything works |
| 100% | The same line, and a note where a paused feature would have run | Limited work above pauses (meeting transcripts and recordings, speech, search grounding, extra regenerations). Sorting, Junk, the brief, first drafts and learning carry on |
| 300% | An email to the person | Automatic drafting pauses until the 1st, so a runaway bill is capped. Sorting and Junk still run, since those protect the inbox |

Nothing is deleted and nothing is lost: paused work is skipped, not queued forever, and the person can ask
for a transcript again after the month turns.

**Guards that never reach a normal person.**
- Per conversation: at most 10 regenerations an hour and 3 automatic drafts a day.
- Per item: input limits (a recording over 500 MB or a voice note over 15 MB is not sent to the model; both limits exist today).
- New accounts (not as built: the code imports 30 days, `INITIAL_SYNC_DAYS`, with no conversation cap; the 90 days and 2,000 conversations below is the original proposal): the first import of old mail triages only the last 90 days and the 2,000 newest conversations,
  and does not count against the allowance. This is the one-off that would otherwise blow a new person's month.
- The check is made by the AI worker before each limited call, from the month's `ai_usage` total (the
  `user_id, created_at` index exists), cached for a minute so it adds no real delay.

**Spotting abuse.** In owner analytics, flag an account whose AI cost this month passes five times the
middle paying user's, or $2 in one day. Like storage, a flag is a number to look at; nothing is blocked
automatically except the 300% rule above.

**Fair usage wording, for the terms of use.** "AI features are included at a generous monthly allowance for
normal use. If use is far beyond normal, we may pause the heaviest features until the next month. Sorting
your mail and your daily brief are never paused."

**Build size (Claude-built).** About one day: a month-to-date cost lookup in the AI worker, the checks before
meeting, speech and regenerate calls, the allowance line in Usage, the abuse flag, and the first-import cap.

**To decide before building.**
1. Is $5 a seat the right starting allowance, or should it wait for real data and start with no limit but the flag?
2. Is pausing automatic drafting at 300% acceptable, or should it only warn?
3. Should meeting recordings count against the same allowance, or have their own (say 10 hours a month)?
4. Should the allowance show in dollars, or only as a percentage?

## Admin and the Waitlist

The marketing page was removed on 28 October 2026 and comes back as the marketing site (3 November 2026, see Marketing
Site): `/` is the public home page again, and its Request Access form will write to the `waitlist` table that `/admin`
already reads. Until that form is built nothing writes to the table.

`/admin` is owner only, like Analytics, and sits above Settings in the navigation. It lists requests
by status (Pending, Approved, Rejected), filters teams and individuals, and approves or rejects with
Undo. The database lets only the owner read or change requests. Approving a team request also makes its
team (see Teams) and shows an invite link for its owner, and Teams lists each team with its seats.

Admin tabs (wave 3, 17 November 2026): AI Usage (the default), AI Budget, Teams and Updates. Requests are
folded into Teams, above the team list. The changelog moved from the main rail into Admin (`/updates` is now the
public changelog). AI Usage opens with the Gemini billing state, written to `ai_status` by the AI worker when its
breaker trips or recovers, the month total with a projection, and who is flagged or paused. A team's percent
and flag use its pooled spend over seats times the budget, as the pause does. AI Budget keeps edits across
tabs, saves only if nobody else saved first, keeps share keys it has no row for, and asks before a share of 0%
pauses a feature for everyone. Changelog saves also check `updated_at`.

## MVP

| Area | What | Status |
| --- | --- | --- |
| Mail | iCloud+ (IMAP and SMTP), Gmail | Built |
| Mail | Microsoft 365 and Outlook through Microsoft Graph (see apps/worker/README.md) | Built, not yet checked on a real account |
| Calendar | Google Calendar | Built |
| Calendar | Outlook Calendar through Microsoft Graph, read only | Built, not yet checked on a real account |
| Calendar | iCloud Calendar through CalDAV, read and create events | Reading checked against a real account. Creating is unit tested only: no event has been made on a real calendar yet |
| Calendar | Apple Calendar (CalDAV, app-specific password) | To do |
| WhatsApp | Personal and WhatsApp Business app numbers through Baileys | Built |
| WhatsApp | Voice notes transcribed and summarised by Gemini (see below) | Built |
| Mail | Any other IMAP and SMTP mailbox (Afrihost, Xneelo, Domains.co.za, cPanel hosts, Yahoo and others), with server settings found automatically. iCloud becomes one preset of the same connector | Building (agreed 26 October 2026) |
| Meetings | Google Meet, Teams and Zoom transcripts, shown as a card in the attendee's conversation, on their contact page and on the calendar event (see Meeting Transcripts below) | Building. Zoom hidden from users (decided 27 October 2026) |
| Meetings | Teams, Zoom and Google Chat conversations, read and reply, including the chat inside a meeting (see below) | Building. Zoom hidden from users |
| Social | LinkedIn messages, signed in on the Konva page through mautrix-linkedin's password sign-in (see Social Messaging below) | Building (changed 27 October 2026) |
| Social | Instagram DMs: Business and Creator accounts through the official Instagram Login, personal accounts through instagrapi. The user picks their account type first | Building (changed 27 October 2026) |
| Tasks | Microsoft To Do, Google Tasks and iCloud Reminders, shown in Calendar on the day they are due and in the daily brief, ticked off from the app. iCloud Reminders through an iCloud.com sign-in on the Konva page, no Mac | Building (changed 27 October 2026) |
| Privacy | Per-user encryption of stored data | In progress |
| Email display | Bold, italics and the like in email and WhatsApp bubbles (see below) | Built, not yet checked on real mail |
| Drafts | Guided drafting, What To Say (typed or spoken), Adjust, Edit Text, saved facts, follow-ups, drafting new emails and WhatsApp messages (see below) | Built; checked offline against 35 real replies and end to end on real conversations, not yet in the browser |
| Brief | Spoken daily brief (see below) | Built |
| Contacts | Rename a contact and edit their company, role, relationship, addresses and numbers. A name set by hand is kept when the address book or WhatsApp name changes | Built |
| Media | Voice notes and audio play inside the conversation (speed 1x, 1.5x, 2x); videos play in the app's own player | Built |
| Notes | Private notes with live markdown formatting and attachments, under Attachments in the rail (see below) | Built, not yet checked in the browser |
| Clients | Client timeline across every channel, with matters (see Client Timeline and Matters, Wave 7) | Built, not yet checked in the browser |
| Leads | Property24 and Private Property enquiry emails turned into clients, through Automations (see Full App Review, 2 November 2026) | To do |
| Onboarding | Sign up, a setup dialog over the app (connect, about you, what Konva found, contacts, a practice reply). The page by page tour was removed on 2 November 2026 (see below) | Built on mock data for the findings, contacts and drafts; not yet checked end to end with a new account |

## How the Key Features Work

### Client Timeline

Each client is one timeline: their WhatsApp chats, emails, voice notes and meetings together, with a
deal, listing, policy or matter attached. Opening "Mrs Naidoo" shows everything. This is what keeps
people from leaving, because their client history lives here.

### Guided Drafting

When a message needs a decision the AI cannot know, the AI does not guess. It offers two to four
one-tap choices and drafts only after the user picks one.

- "Are you available on Thursday at 3?" shows Yes, No and Suggest Another Time. Suggest Another Time
  reads the calendar and offers free slots to tap.
- "Can you send the documents?" shows Sending Now, Tomorrow and Which Documents.
- A price, offer or yes or no question shows the matching answers, plus a field to type what to say.

The chosen option and any typed note go into the prompt, so the draft says what the user decided in
their own voice. Choices picked again and again become learning signals, like the existing tones
(Shorter, More Formal, More Casual).

How it is built:

- Triage already reads every incoming email and WhatsApp message (except bulk senders the model has
  labelled the same junk way in its last 3 answers, which are skipped and rechecked every 14 days;
  on the first 1,409 emails that skips 44% of calls, and the model disagreed on 2 of those). In the
  same model call it returns
  the choices, the time asked about and how long it would take. They are stored encrypted in
  message_ai.reply_choices. Messages triaged before this get theirs when triage has nothing new to
  do, while they still need a reply.
- The buttons sit above the reply box, in the outline style of the tone buttons, only while the
  latest message is someone else's and no draft is open. Draft Reply stays for anything else.
- An availability question is checked against the calendar ("Your calendar is free on Thursday 29
  October, 15:00", or what is on then). Suggest Another Time offers up to three free whole hours
  between 08:00 and 17:00 over the next week, at most two a day.
- The pick is stored on the draft (drafts.decision, encrypted, and drafts.decision_kind) and kept
  when the user asks for another tone or regenerates.
- Repeated picks become style rules: the learner reads what was picked, what was decided and what
  was finally sent, and writes rules only for patterns that repeat, such as how the user confirms a
  time or turns something down.

### Pre-Drafting

Decided 26 October 2026. A draft is written before it is asked for, so it is already in the reply box
when the user opens the conversation. Asking for one takes about 4 seconds; most of that is the model.

When a draft is written:

- While the app is open and in view: about 30 seconds after the last change to a conversation (so a
  burst of WhatsApp messages gets one draft), once triage has read it.
- When the user opens a conversation that qualifies and has no draft yet.
- Never while the app is closed. Most replies are still sent from the phone or Gmail (on the owner's
  account 28 of 164 replies in two weeks went through the app), so drafts written then would mostly
  go unseen.

Which conversations qualify:

- One to one (not a group), the latest message is someone else's and is under 7 days old.
- Triaged as personal, work or needs reply, and not junk. Newsletters and notifications are skipped.
  Triage's needs reply flag alone is too strict: it missed 8 of the 15 WhatsApp chats and all 7 email
  conversations the owner replied to in two weeks.
- Skipped when the latest message has guided drafting choices, as the draft would have to decide for
  the user. Picking a choice drafts as before.
- Skipped when a draft was already asked for, discarded or written since the latest message.
- At most 15 a day per user (30 until the cost pass; written by the model in the last 24 hours; enforced in request_auto_draft and again by the AI worker, so a row inserted directly cannot skip it). After that, drafts are asked
  for as before.
- Settings, Auto-Draft Replies turns it off (profiles.auto_draft_top, on by default).

How it is built:

- The app calls public.request_auto_draft(thread), which checks all of the above and adds a pending
  draft marked auto with the message it answers (drafts.auto, drafts.for_message_id). One per message,
  so two open devices make one draft.
- The AI worker writes auto drafts after the ones people asked for, and drops one whose message is no
  longer the latest or that has choices, without calling the model.
- A pre-draft that goes stale (a newer message, a reply sent from anywhere, or a newer draft) becomes
  expired, not discarded, so learning never treats a draft the user did not see as one they threw away.
- A pre-draft never replaces text the user is typing.
- Analytics: draft_requested with source auto, and auto on draft_shown, draft_sent and draft_discarded,
  so /analytics shows how many pre-drafts are sent as they are, edited, discarded or never used.

Cost: a draft averages 1,116 tokens in and 73 out, about R0.018 now and R0.035 from 1 January 2027,
when Gemini 3.8 Flash doubles in price. The owner's volume would be about 300 a month if every
qualifying message were drafted (R5 now, R11 from January); the cap holds a busy user to R32 a month
at January prices, and drafting only while the app is open should be well under that. All AI use is
about R39 a month on the owner's account now and doubles in January, above the R70 cost to run a user
before hosting and card fees, so that estimate needs revisiting either way.

### Editing Your Own Text

When the reply box holds text the user wrote, or an AI draft they changed, Edit Text sends it to the
AI for light correction instead of a new draft: spelling, grammar, punctuation and phrasing that is
wrong or hard to follow. Their words, sentence order, line breaks, length, greeting, sign-off and
level of formality stay; nothing is added or dropped; text that is fine comes back unchanged.
Afrikaans, isiZulu, mixed languages and slang (ja, lekker, now now) are never "corrected".

- Built on drafts: a draft with tone 'edit' carries the text in drafts.source (encrypted as a draft
  body). The worker uses the same prompt as a draft (voice, this person, the conversation, so names
  are spelled right) ending with the text to correct, at a low temperature.
- Runs on the fast model (flash-lite) with medium thinking: 2 to 5s, where the full model took 2 to
  17s. On low thinking flash-lite let every typo in an all-lowercase message through.
- Straight quotes stay straight unless the user typed curly ones.
- On 5 sample replies the edits kept 90 to 99% of the text the same.

### Drafting Overhaul (October 2026)

Four analyses (code audit, cost, latency, and an offline check of drafts against 35 replies the user
really sent) found that drafts are fast enough (about 5s) and cheap (about $0.001 each), but the first
draft was almost never sent: 0 of 23 single-draft requests, and every send took 4 to 7 attempts. The
check showed why: in 20 of 35 replies the right answer depended on something only the user knew.
Given an 8-word instruction, sendable drafts in those went from 3 of 20 to 15 of 20. So the composer
now asks first.

The reply box:

- What To Say: a line above the reply box, there before any draft, typed or spoken. Draft (or Draft
  Follow-Up when the user wrote last) writes from it; empty, it drafts on its own. The instruction
  stays with the draft, so Redraft and Adjust keep it (they used to drop it).
- Speak (the waveform button): say what the reply should say. The clip is sealed with the user's key
  (FIELD voice_instruction), uploaded to attachments/<user>/drafts/, heard in the same model call
  that writes the draft, and deleted. What was said becomes the draft's instruction.
- Adjust menu (Shorter, More Formal, More Casual) replaces the three tone buttons, which were used for
  1 of 66 drafts. It changes the text in the box, the user's edits included, keeping every fact, on
  the fast model in about 1s, instead of writing a new draft.
- Undo after any draft, edit or adjustment that replaced text in the box. Text typed in a
  conversation is kept when the user moves to another and back (for as long as the app is open).
- Edit Text stays as its own button.

Drafts themselves:

- Channel-aware prompt: WhatsApp drafts are chat messages (no greeting line or sign-off unless the
  user writes them on WhatsApp), email drafts are emails; the user's own messages in the conversation
  decide greeting and register; replies match the conversation's language. Voice examples come from
  the same channel only. Offline: email style on WhatsApp 4 times to 0, formality right 30 to 35 of 35.
- Group chats name every sender; attachments, photos and quoted messages are shown in the
  conversation; when the user wrote last, the draft is a follow-up, not a reply to themselves.
- Saved facts: a note marked Use in Drafts (note menu) goes into every draft's prompt (up to 15
  notes, 6,000 characters) for fees, checklists and addresses, quoted exactly.
- A draft that was edited or adjusted is 'revised', not 'discarded', so learning no longer reads it
  as thrown away.

New messages:

- New Email and New WhatsApp have the same What To Say line (typed or spoken), Edit Text and Undo. An
  email draft fills the Subject too. The draft has no conversation (drafts.thread_id null, account_id
  and contact_id set, the contact found from the first address or the number); the worker reads
  public.compose_context, the same parts as a reply without the conversation, and refuses a request
  with nothing to say. The draft's id goes out with the message (outbox.draft_id), and learning reads
  it once the conversation is filed. A draft left unsent when the dialog closes is thrown away.

Waiting on them:

- When the user wrote last in a one-to-one conversation more than a day ago, the AI worker reads that
  message once (full model: the fast one missed sent documents and proposed times) and stores whether
  it expects an answer in follow_ups. The Waiting filter in All lists those unanswered for 2 days;
  Draft Follow-Up writes the nudge.

Speed:

- The worker warms the Gemini connection while it reads the context (about 0.6s saved on a cold
  start), a model call with no answer after 4.5s is raced by a second one (8 to 10s calls were seen
  against a usual 2.6s), and the app shows a draft it is waiting for the moment it arrives.
- Not done, by measurement: streaming (replies are short, it would save 0.2 to 0.6s), explicit
  Gemini caching (the prompt is under the 1,024-token minimum), prompt trimming (under 0.1s).

Not built yet:

- Draft versions (back and forward through earlier drafts) and showing what an edit changed.
- Style rules tagged by channel (all 11 learned rules are email rules), and a profile "about" that
  matches the user's real mail: both hurt drafts in the offline check.
- Waking the worker from Realtime instead of polling (about 0.75s), and running it next to the
  database (about 0.7s), with the planned Confidential Space move.

### Spoken Daily Brief

Every morning: today's meetings and viewings, clients waiting on a reply, and anything urgent. It can
be read on screen or listened to in the car, using Gemini to speak it. It builds a daily habit and is
the main reason to open the app on the move.

How it is built:

- The AI worker writes one brief a day at the user's briefing time (07:00 by default) in their time
  zone, which the app keeps in step with their device. It runs in its own thread.
- The script comes from the same labels as the Summary page (needs a reply, urgent or important,
  updates from the last day, with each conversation's one-line summary) and today's calendar. No
  message bodies are read. It is 120 to 220 words, written to be heard, with times said naturally.
- Gemini 3.8 Flash TTS reads it aloud. About a minute of audio costs about $0.02, and speech is
  about 93% of what a brief costs, so the morning brief is written as a script only and spoken
  when someone presses Listen (status written, then speak_pending set by the app). A brief asked
  for in the app is written and spoken at once. The speech model is sent the script alone: style
  directions in its prompt were sometimes read aloud, and it does not take a system instruction.
- The audio is spoken in parts at sentence ends: a short first part on its own, then the rest at
  once, each stored as it is ready. A new brief starts playing about 12 seconds after it is asked
  for, and a ready one in about 2 seconds. Decided 2 November 2026: keep the parts for the quick start,
  accepting that the voice can shift slightly at a join. Each part is sent with no style line in front:
  one had crept back in and was read out at the start of every part.
- The script and the audio are stored encrypted (briefs, brief_parts) and deleted after 7 days.
- On the Summary page, Listen plays it, writing a fresh one first when there is none, the voice
  changed, or conversations moved on since it was written more than an hour ago. The script shows
  while it plays, and the phone's lock screen gets play and pause. Refresh writes a new one.
- Settings, Notifications, Daily Brief: the time, the voice (six, each with a sample in
  apps/web/public/voices) and the playback speed (1.15x by default; the voice's own pace is slow).
- It speaks to the user as "you" and never says their name except in the greeting.
- Still to do: a smaller audio format than WAV (about 3MB a minute).

### Email Display

The AI does not rewrite conversation emails for layout. It is slow, costs money per email and can change wording.
Marketing and notification mail is the exception since 28 October 2026: see Readable Bulk Email below.

1. Conversation emails (a person writing to a person): convert the HTML to a small set of
   formatting (bold, italics, links, lists, line breaks), remove quoted replies and signatures, and
   show it in the chat bubble, like WhatsApp formatting.
2. Marketing and notification emails (GitHub, newsletters, receipts): show the original HTML in a
   sandboxed frame with a one-line AI summary above it.

Test on 30 or more real emails, marketing ones especially, in the browser before calling it done.

How formatting is built:

- Email HTML is no longer stored (see Privacy and Encryption), so when an email arrives the worker
  notes which phrases its HTML made bold, italic, underlined, struck through or code. That list is
  stored encrypted in messages.body_marks. The app finds those phrases again in the bubble text and
  draws them. No sender HTML ever reaches the page.
- Emails stored before this got their list from their HTML in the same pass that cleared it
  (pnpm drop-stored-html, run on 23 October 2026: 1,077 emails, 1,015 kept formatting).
- WhatsApp text is kept as sent and drawn the way WhatsApp draws it: *bold*, _italic_,
  ~strikethrough~, `code` and ```monospace```, quote lines and bulleted lists.

### Readable Bulk Email (28 October 2026)

**Why.** Newsletters, marketing and notifications convert badly to text: image-only layouts, tracking links, button labels with
no context, repeated footers. Today they show a trimmed preview (`bulkPreview`) and View Original. This replaces the preview
with a short AI-written readable version. It revises the earlier rule that the AI does not rewrite emails for layout, and
only for bulk mail. A person writing to a person is unchanged, and WhatsApp, Instagram and LinkedIn messages are shown as sent.

**What it makes.** One summary line, up to 5 key points (the offer, dates, prices, the deadline, what is being asked), and up to
4 links, each labelled by what it does ("View the Sale") and taken only from links that are really in the email. View Original
stays one click away, and the readable version is marked "Summarised by AI" so nobody mistakes it for the sender's words.

**Which mail.** Messages with an unsubscribe header or `is_bulk`, including junk and subscriptions. Not personal mail,
and not mail the AI worker cannot read (see Limits).

**When (decided 28 October 2026).** Only when the user opens the message, never on arrival. Most junk is never opened,
so nothing is spent on it. The request is the same pattern as `email_originals` and `attachment_fetch_requests`:

1. Opening a bulk message with no readable version inserts a row in `bulk_reads` (user, message, created, claimed, error).
2. The AI worker claims it, opens the sealed `body_text` and `list_unsubscribe`, extracts the real links, and asks the fast
   model for the summary, points and link labels as JSON (`bulk_read.py`, the one new module).
3. It checks the answer (below), seals it and stores it on the message (`message_ai.bulk_read`, sealed as field `bulk_read`),
   then deletes the request. Realtime pushes the change; the app swaps the skeleton for the result.
4. Reopening is instant: the result is stored, not regenerated.

**Rules for the answer.**
- The model returns JSON only: `summary`, `points[]`, `links[{label, id}]`. Links are chosen by number from the list the code
  extracted, so a link the email does not contain cannot appear, and the app shows the real address under the label.
- Output is plain text. No HTML or Markdown is ever rendered. Limits: summary 160 characters, 5 points of 120, 4 labels of 40.
- The email sits inside the random fence used by triage and the prompt says it is untrusted (`UNTRUSTED`), so text in an email
  cannot give the model instructions. Dashes are stripped from the output to match the app's text rules.
- Numbers, dates and prices in `points` must appear in the email text; a point whose figures do not is dropped. If nothing is
  left, the app shows the existing preview as it does today.

**Where it shows.**
- `MessageBody` shows the readable version in place of `bulkPreview` when one exists (skeleton while it is made, existing
  preview if it fails). "Show Full Text" and View Original are unchanged.
- The inbox row for bulk mail keeps its subject line. The Summary page is unchanged.

**Limits.**
- Bulk mail older than 30 days is already shortened to about 500 characters (`body_shrunk_at`). Those messages keep today's
  preview; an AI reading of 500 characters adds nothing. Reading them from the original is a later option through `email_originals`.
- The worker never calls the mailbox for this. It uses the stored text, which keeps links as addresses.
- Mail whose text is mostly images has little to summarise; the model is told to say so, and the app keeps "mostly images".

**Cost (estimate, to measure).** About 700 tokens in and 150 out on the fast model at its listed price is roughly $0.0006
per email read, so about $0.60 per 1,000 opened. It is a new feature in AI Fair Usage with its own share in Admin (starting
5%, taken from Sorting and Junk, which is 30% today), a weekly limit like Drafts, and a content-free usage event so cost per
email read shows in Analytics. Usage is filed under `bulk_read`, not `triage`. When the share is spent, the preview shows as it does today.

**Privacy.** The same text is already sent to Gemini for triage. The result is sealed per user like summaries. Nothing is logged
but counts and ids. Analytics are content free and need no new event type: every call is already an `ai_call` event with
feature `bulk_read` (count, cost, failures), and the app records `feature_used` with detail `shown` or `failed`.

**Build order.**
1. Migration `supabase/migrations/<timestamp>_bulk_reads.sql`: `bulk_reads` table with RLS (insert and select own, as
   `attachment_fetch_requests`), `message_ai.bulk_read text`, a Realtime publication entry, an index on unclaimed requests.
   Then hand-merge `packages/db/src/database.types.ts` (never overwrite it).
2. `fields.py` and `packages/crypto/src/fields.ts`: new field `bulk_read`; the crypto vectors test must still pass.
3. `apps/ai/ai/bulk_read.py` with its test file: link extraction, prompt, JSON schema, answer checks, claim and write.
   A pure `check_answer(email_text, links, answer)` holds the logic that needs testing. Start the loop from `__main__.py`.
4. `pricing`, config and `describe_jobs`: model and thinking level (minimal), the new feature name, the Admin share and weekly limit.
5. Web: ask on open and listen for the answer in `message-body.tsx`'s bulk branch, a small `bulk-read.tsx` for the readable view,
   `Message.bulkRead` in `types.ts` and `data.ts`, and the "Summarised by AI" label. Stock shadcn only (Skeleton, Badge, Button).
6. Analytics events and the Admin share. Write and publish the entry on the Updates page before pushing.
7. Check on 30 or more real bulk emails, read-only, in the browser on `localhost:3000`: marketing, receipts, newsletters,
   notifications, image-only. Look for invented figures, wrong link labels and anything that reads like the sender's own words.

**Built (28 October 2026).** `supabase/migrations/20261114100000_bulk_reads.sql` (apply it before using the feature),
`apps/ai/ai/bulk_read_text.py` and `bulk_read.py` (own thread in `__main__.py`, model: the triage model at minimal thinking),
field `bulk_read` in both `fields` files, `apps/web/lib/bulk-read.ts` and `components/bulk-read.tsx`, and the Admin, Usage and
Settings labels. Until the migration is applied the app shows the old preview. Shared team chats never ask for one. After
applying it, check on 30 or more real bulk emails (step 7) before publishing the Updates entry. If Admin is saved before the
migration is applied, the new feature's share is saved as 0 and it stays paused until a share is set.

**To decide.** Whether to also read shrunk old mail from the original, and whether the readable version should be offered
for long personal mail.

### Voice Notes

Baileys downloads the audio and Gemini transcribes it, so there is still one AI provider. The
transcript is searchable and summarised in the timeline. Test with South African accents, Afrikaans
and mixed-language notes.

How it is built:

- The AI worker's transcribe job (apps/ai/ai/transcribe.py) checks every 5 seconds for voice notes
  the sync worker has saved. It sends each one to Gemini 3.8 Flash once, asking for exactly what was
  said, in the language it was said in (no translating). A minute of audio costs about $0.002.
- What was said is stored encrypted in messages.transcript (field "transcript").
  messages.transcript_status is 'done', 'silent' when nothing could be made out, or 'failed' after
  three tries.
- In the app, a voice note in a chat has View Transcript under the player, which opens the text in
  the bubble. A transcript that arrives while the chat is open appears without a reload.
- Triage holds a voice note back for up to 15 minutes until its transcript is ready, then reads the
  transcript as the message. So the conversation's summary, needs reply, the one-tap choices and the
  daily brief know what was said, and a voice note that matters shows up in the brief.
- Drafting reads the transcripts in the conversation, so a reply answers what was said.
- A voice note that was triaged before its transcript existed is triaged again once it is
  transcribed, if it is within triage's 30-day window.
- Usage is filed as "Voice Note Transcripts" in Settings, Usage.
- Only voice notes are transcribed, not other audio files people send.

Sending voice notes (built 26 October 2026):

- WhatsApp reply box only: a microphone button next to the paperclip. While recording, the text box
  becomes "Recording" with the time, and Cancel and Stop take the Send button's place. Stop adds the
  note to the reply's files as a chip you can play, scrub and remove; Send via WhatsApp sends it with
  any text and files, each as its own message. Notes under 1 second are dropped, as WhatsApp does.
- The browser records Ogg or WebM Opus (MP4 in older Safari). It uploads like any outbox file, with
  outbox_attachments.voice_note = true (only allowed on audio).
- The sync worker converts it with ffmpeg (apps/worker/src/whatsapp/voice-note.ts) to mono 48 kHz Opus
  at 32 kbps in Ogg, works out its length and the 64-bar waveform, and sends it with ptt set, so it
  arrives as a voice note rather than an audio file. Sent notes are stored and transcribed like
  received ones.
- ffmpeg is a system binary, not an npm package: the worker's container image needs it when the worker
  moves to Confidential Space.

### Meeting Apps: Chats and Replies

Teams and Zoom are where some clients talk between meetings, not only during them. Bring in
their conversations as well as the transcripts, so they sit in the client timeline next to WhatsApp
and email, and let the user reply to those people from Konva. Triage, the brief and guided drafting
treat them like any other conversation.

| App | Read | Send | Notes |
| --- | --- | --- | --- |
| Teams | Chats and meeting chats through Microsoft Graph (Chat.Read) | ChatMessage.Send, as the user | Same Microsoft sign-in as Outlook and Outlook Calendar. A Teams meeting's chat is an ordinary chat thread, so it comes in with the rest |
| Zoom | Team Chat API for ongoing chats. In-meeting chat comes from the cloud recording's chat file | Team Chat API, as the user | In-meeting chat is only kept when the meeting is cloud recorded, which needs a paid Zoom plan |

Google Meet's own chat disappears when the call ends and the Meet API does not return it, so Google's
equivalent of Teams chat is Google Chat. Decided 26 October 2026: bring in Google Chat with Meet. Both
need a Google Workspace account; personal Gmail has neither Meet transcripts nor the Chat API.

How it fits together:

- Meeting participants are matched to contacts by email address, the same way email is, so a Teams
  chat with someone already on WhatsApp joins their existing client record.
- A reply goes back through the app the conversation came from. If that is not possible (for
  example the person is outside the user's organisation and Teams or Zoom blocks outside chats),
  offer the client's other channels: email or WhatsApp.
- Sending follows the same rules as email and WhatsApp: the user always sees and taps Send.
- Message text is encrypted per user like every other message (see Privacy and Encryption).

Decided 27 October 2026: Zoom is hidden from Settings and onboarding, with its code kept. Every other
Zoom account needs Zoom Marketplace review (4 to 12 weeks), free Zoom has no cloud recordings, and
Team Chat is little used for client work. Google Meet and Teams cover meetings until then.

Teams, Zoom and Google Meet with Google Chat are being built in parallel from 26 October 2026, each
by its own agent, then merged. Testing on real accounts comes after, and needs a Microsoft 365 tenant,
a paid Zoom plan with cloud recording and a Google Workspace account with transcription.

### Meeting Transcripts

Decided 26 October 2026. A meeting is stored once, with its transcript, an AI summary and action
items, and shows in three places:

- As a card in the conversation of each attendee who is a contact, placed by time among the messages.
  The card shows the platform, title, time and length, the summary and the action items. View
  Transcript opens the full transcript by speaker, with search.
- In a Meetings section on the contact page.
- On the meeting's calendar event, matched by its join link, or by time and attendees.

Transcripts come from the platform when transcription was on. When there is only a recording (Zoom
audio), the AI worker transcribes it with Gemini, the way it does WhatsApp voice notes. Attendees are
matched to contacts by email address. The transcript, summary and action items are encrypted per user.

### WhatsApp Safety And History

Decided 2 November 2026 (Wave 6). WhatsApp stays on Baileys; the official WhatsApp API is not built.

- **Send rails.** Each account sends one message at a time, a jittered gap apart (6 s plus up to 6 s), with "typing" shown for a realistic time
  first (about 45 ms a character, 1.2 to 8 s) and 2 to 4 s between the parts of one message. A cap of 300 messages in any 24 hours, and a stricter
  20 to people the account has never chatted with (a new chat, or a conversation where they have not written). All set by environment variables
  (`WHATSAPP_DAILY_CAP`, `WHATSAPP_NEW_CHAT_CAP`, `WHATSAPP_MIN_GAP_SECONDS`, and so on; `apps/worker/.env.example`). A message over a limit does
  not fail: it stays queued, `outbox.wait_reason` says why and `send_after` moves to when the limit lifts. The app shows "Waiting: Daily WhatsApp
  Limit" or "Waiting: New Chat Limit" with Cancel.
- **Edit and delete history.** Before an edit or a deletion replaces a message's text, the text is kept sealed in `message_versions`. The bubble shows
  "Edited" or "Deleted by Sender", and both open View Original. A message deleted before this change has no original to show.
- **Business labels.** For a WhatsApp Business account, labels sync one way (WhatsApp to Konva) into Konva labels, with names sealed, and a label on a chat
  becomes the label on its conversation. Labels on single messages are not shown.
- **Missed calls and polls.** A missed WhatsApp call is stored as a "Missed Voice Call" or "Missed Video Call" line. A poll shows its options with vote
  counts, kept as positions per voter on the poll message; votes are read with the poll's own key, which is stored sealed.

### Social Messaging

Decided 26 October 2026: LinkedIn and Instagram connect through open-source Python libraries, the way
WhatsApp connects through Baileys, rather than a paid service. Unipile was priced at about 4.50 to 5
euro per linked account each month (about R160 to R200 for a user with both), too much against a
South African subscription.

Changed 27 October 2026, after testing how much friction each connection had. The rule: every
account connects on the Konva page alone (a sign-in button, a form, or a QR code). No terminal step,
no Mac app, no browser extension, and no copying cookies.

| App | How it connects | Notes |
| --- | --- | --- |
| LinkedIn | The user types their email and password in Konva. The worker signs in with mautrix-linkedin's password sign-in (the Go helper in apps/linkedin, built on its linkedingo package; not linkedin-api), and the form asks for the email, SMS or authenticator code, or for approval in the LinkedIn app | The password is dropped once signed in. The cookies and the browser's User-Agent are kept together, since LinkedIn ends sessions whose User-Agent changes. A CAPTCHA cannot be solved for the user, so the form asks them to approve in the LinkedIn app and try again |
| Instagram, Business or Creator | The official Instagram API with Instagram Login: Continue With Instagram, approve, done | No password and no ban risk. Replies only within 24 hours of the client's last message; after that the conversation says to reply in Instagram. Needs Meta Business Verification and App Review before other accounts can connect; the owner's own account works straight away |
| Instagram, personal | instagrapi (Instagram's private mobile API), with the username, password and code form | The most ban-prone connection. The page says so plainly |

The Instagram page asks for the account type first and routes to the right sign-in. Not Sure explains
where to check in the Instagram app and that switching to a professional account is free.

How they run: as their own processes beside the AI worker (LinkedIn as a Go helper the sync worker
starts per account, Instagram in Python), storing conversations in the same tables as WhatsApp. They
never mark chats as read unless the user reads them in Konva, never send without the user tapping
Send, and stop at the first sign of a restriction until the user reconnects. Reconnect reopens the
same sign-in form.

LinkedIn helper, decided 27 October 2026: the Go helper (apps/linkedin) is used for now. It was first built
and tested that day with Go 1.27.3 (`go vet`, `go build`, `go test` all clean). Before launch it moves to
Python, beside the Instagram connector in apps/ai, speaking the same stdin and stdout protocol so the sync
worker only changes the command it starts. Two reasons: hosting needs only Python, and the Python helper is
written from scratch rather than translated from linkedingo, so it is not under the AGPL (a translation would
still be), which matters to anyone who later buys or invests in Konva. It still needs live testing against
LinkedIn either way, with the same sign-in checks (email, SMS or authenticator code, app approval).

LinkedIn helper in Python, 28 and 29 October 2026: the Python helper is `apps/ai/ai/connectors/linkedin`
(`python3 -m ai linkedin`), with the whole stdin and stdout protocol, the sign-in state machine, file and picture
checks, profile matching and error mapping (`apps/ai/tests/test_linkedin.py`). On 29 October the LinkedIn client was
written from HAR captures of the web app in a browser, not from reading linkedingo, so the helper stays clear of the
AGPL: conversations, messages, send, start a conversation, file upload, mark read, search and the real-time stream
(`factory.py`, `api.py`, `session.py`, `realtime.py`, `mapping.py`; tests in `test_linkedin_client.py`, and the mapping
was also run over the captured responses with no errors). Captures are kept in `captures/linkedin` (git ignored, they hold
cookies and a password).
Still open before the worker switches from the Go helper: (1) the password sign-in, which is one large server-driven-UI
request (`flagship-web/rsc-action`) with a browser fingerprint in it, behind LinkedIn's bot checks (`sensorCollect`, reCAPTCHA
Enterprise); nothing shows yet whether it can be made from a server, and the code and app-approval steps have not been
captured; (2) sending into an existing conversation, document and video uploads, and message events from the real-time
stream were not in the captures (marked UNVERIFIED in the code); (3) one live read test with a real session. `queries.py`
holds LinkedIn's query IDs, which change when it ships a new web build. The Go helper and `apps/linkedin` are deleted in
the same change that switches the worker's command. Scope is the Go helper only: the worker, web app and packages are TypeScript.

Which LinkedIn helper is live (checked 2 November 2026, for the owner to decide the switch). The Go helper in
`apps/linkedin` is the live one: the worker starts `apps/linkedin/bin/konva-linkedin` (or `LINKEDIN_HELPER`) per account
(`apps/worker/src/linkedin/helper.ts`), and the password sign-in only exists there. The Python helper in
`apps/ai/ai/connectors/linkedin` is the replacement and nothing starts it yet. Nothing is deleted. Left before the
switch: the password sign-in (`factory.password_login` still answers `unsupported`, and the code and app-approval steps
were never captured); the UNVERIFIED parts (sending into an existing conversation, document and video uploads, message
events from the real-time stream); one live read-only test with a real session; then change the worker's command to
`python3 -m ai linkedin` and delete `apps/linkedin`, its CI step and `linkedin:build` in the same change. If the
password sign-in cannot be made from a server, the choice is a cookie connect in the web page or keeping the Go helper.
Reactions, decided 2 November 2026: the worker sends them (`linkedin/reactions.ts`, a `react` helper command with the
conversation and message URNs, an emoji or an empty one to remove yours) and keeps yours on the message. Neither helper
has the `react` command yet, so until one does a reaction fails with "Could not send your reaction to LinkedIn."; the
reaction button is still shown for WhatsApp only.

Instagram webhooks, decided 2 November 2026. Meta calls `/api/meta/webhook` (GET handshake with
`META_WEBHOOK_VERIFY_TOKEN`; POST checked against `X-Hub-Signature-256` with `INSTAGRAM_APP_SECRET`). A valid event
writes a content free row to `meta_webhook_hints` (the account's Meta ID and the kind of event, never a sender,
conversation or text), the Instagram connector takes it within about five seconds and reads that inbox, and the full
poll slows to a safety net of 15 minutes (`INSTAGRAM_WEBHOOKS` on in `apps/ai/.env`). With it off, nothing changes: the
minute poll runs. Replies follow `window.py`: within 24 hours of their last message as before; up to 7 days with the
HUMAN_AGENT tag when `INSTAGRAM_HUMAN_AGENT` is on (and `NEXT_PUBLIC_INSTAGRAM_HUMAN_AGENT` in the web app), which
needs Meta's Human Agent feature approved in App Review; otherwise the composer shows "Reply Window Closed".

Proxies, decided 27 October 2026: none at launch. A user's own code or app approval gets the sign-in
through from any IP; the risk is later, when a session used from a data centre is checked again or
the account is restricted. Each connection can take a per-account proxy, and sign-in checks and
restrictions are counted per connector. If LinkedIn or personal Instagram show trouble, add a
home-internet (residential) proxy for those two only, estimated at $0.50 to $4 a user each month.

### Repeating Events

Built 27 October 2026. Each occurrence of a repeating event stores its series' rule (`calendar_events.recurrence`,
iCalendar's RRULE such as `FREQ=WEEKLY;BYDAY=TU`; migration `20261031120000_calendar_recurrence.sql`).

- **Synced:** Google occurrences do not carry the rule, so the sync worker reads each series' own event for it,
  once an hour. iCloud sends occurrences already expanded, so it reads each series' file the same way. Outlook is
  shown, not changed, and has no rule stored.
- **Shown:** the event details say it in words ("Every Week on Tuesday", "Every Month on the Last Friday, 6 Times";
  `apps/web/lib/recurrence.ts`), or "On a Custom Schedule" for a rule they cannot put in words.
- **Changed:** the event dialog has a Repeat choice (Does Not Repeat, Every Day, Every Weekday, Every Week, Every
  Month, Every Year, or the event's own custom rule) for Google and iCloud. A new event can repeat. A new repeat for
  a series is saved to the whole series (Save All Events), keeping its skipped dates; a single event can be made to
  repeat. A series cannot be turned back into one event from Konva: delete it, or change it in the calendar.

### Tasks and Reminders

Decided 26 October 2026. Microsoft To Do (Tasks.ReadWrite, same Microsoft sign-in), Google Tasks (the
tasks scope, same Google sign-in) and iCloud Reminders sync into one tasks table:

- Calendar shows each task on its due day: all-day ones in the all-day row, timed ones at their time,
  overdue ones on today. A tick completes it at the source.
- The daily brief reads out what is due today and what is overdue.
- iCloud Reminders, changed 27 October 2026: Reminders lists upgraded since iOS 13 are not served
  over CalDAV, and the owner ruled out a Mac app. So it signs in the way iCloud.com does: the user
  types their Apple ID and password in Konva, then the code from their Apple device. Sync runs in
  the Python worker through pyicloud's Reminders service (iCloud's CloudKit Reminders database),
  which reads, completes and creates reminders, subtasks included. The costs, said plainly on the
  page: app-specific passwords do not work here, the user signs in again about once a month, and the
  session reaches the whole iCloud account, so Konva only ever calls Reminders and keeps the session
  encrypted. With Advanced Data Protection on, the user first turns on Access iCloud Data on the Web
  and approves a prompt on their device. The Mac relay (apps/mac-relay) was removed on 2026-10-28, along with
  the worker's relay endpoint and connector.

### Notes

A place to write things down next to the conversations: call notes, to-do lists, quotes to send.
Agreed 25 October 2026.

- **Where:** Notes sits in the rail directly under Attachments. The page is laid out like
  Conversations: the list on the left third, the open note on the right two thirds, and on phones the
  list fills the screen and a note opens full screen with a Back button.
- **List:** the "Notes" title, then a Search Notes field where the Conversations views are and a
  New Note button (secondary) where the filter is. Rows show the title, the time it was edited and
  the first line of text. Pinned notes come first, then the most recently edited. Pin and Delete are
  on hover and right-click; Delete asks first.
- **Note:** the same header as a conversation and the same 672px column, so text lines up where chat
  bubbles do. A title field, then the editor. A toolbar under the header: bold, italic, strikethrough,
  inline code, headings 1 to 3, bulleted, numbered and check lists, quote, code block, table,
  divider, link and attach. Saves itself a second after typing stops.
- **Editing:** live formatting (Tiptap), so markdown shortcuts turn into formatting as you type and
  pasted markdown is converted. Stored as markdown text. HTML typed or pasted as text stays text.
- **Files:** picked, dropped or pasted. Stored in the private attachments bucket at
  `<user id>/notes/<note id>/<uuid>`, with the real name only in an encrypted column. Images show
  inline; PDFs, video, audio and other files show as tiles that open the usual viewer. The markdown
  holds `attachment:<id>` references, never links. 50 MB per file. Files taken out of a note are
  deleted when the note is closed (so Undo can bring one back while it is open), a note left empty
  is dropped when closed, and deleting a note deletes its files.
- **Privacy:** title, text and file names are encrypted per user like messages (fields `note_title`,
  `note` and `note_file`). Search runs in the browser.
- **Safe saving (Wave 3, 17 November 2026):**
  - A save only applies if the note still has the edited time this tab last read. If another tab or
    device changed it, the note stops as a conflict and nothing is overwritten: the bar over the note
    offers Keep Both (the other version becomes a new note named "... (Other Version)"), Use Other
    Version, or Keep Mine Only. A note deleted elsewhere offers Save Again. The edited time now moves
    only when the title or text change (migration 20261117120000), so pinning does not cause conflicts.
  - Notes are in Realtime and the list refreshes when the tab comes back or the device is online again.
  - A failed save retries on its own (2, 5, 15, 30 then every 60 seconds) and at once when back online.
    The header says "Offline, Will Save When Back Online" or "Not Saved, Retrying".
  - Leaving the page sends unsaved text with a keepalive request (also when the tab is hidden). The
    "leave this page?" prompt appears only when text could really be lost: a failing or conflicting
    save, offline, or a note too long for that request (about 40,000 characters).
  - Text that cannot be decrypted is never shown as empty and never saved over: the note says it
    could not be opened. Closing never deletes a note whose text or files did not load.
  - A note that could not be made keeps its text and is written again with the next save.
- **Use in Drafts:** a checked item in the note menu and the row's right-click menu, a badge on the
  row and in the note header, and a line over the list ("3 of 3 Notes Used in Drafts"). The badge and
  the line warn when the limits (15 notes in id order, 1,500 characters each, 6,000 in all) cut a note
  short or leave it out (`lib/note-facts.ts` repeats the AI worker's numbers).
- **List details:** rows show checklist progress ("3/5"); the open note keeps its place in the list
  until it is closed; a blank title reads "Untitled Note" everywhere; with no notes the pane says
  "Write Your First Note". Esc or Cmd+Enter in a note returns to the list, Cmd+Shift+P pins it.
- **Analytics:** `note_created`, `note_file_attached` (with the file kind) and `note_deleted`, as
  `feature_used`, with no content.
- Markdown formatting is for notes only; the message composer is unchanged.
- Not yet: notes in Cmd-K search, note files on the Attachments page, linking a note to a client.

Build time, Claude-built: about 3 to 4 hours.

### Company Logos and Sender Names (October 2026)

- **Logo system (agreed 26 October 2026, replaces the first version below it):** one logo per company
  domain, shared by every user, so each company is found once. Target: fewer than 1% of companies end on
  the fallback.
  1. **Candidates, all free:** the App Store (iTunes Search API, only apps whose publisher matches the
     company), BIMI, the company's own site (apple-touch-icon, manifest, SVG icons, favicons), Google's
     favicon service at 256px, Wikipedia and Wikidata logo files, and Simple Icons last (one colour only,
     so it gets brand colours wrong for multi-colour logos).
  2. **Framing standard:** every candidate becomes a 256px PNG. Logos that already fill their square
     (app icons) fill the circle while the mark stays inside a safe zone. Loose marks are trimmed,
     centred on the visible shape and scaled to fit a fixed safe circle however wide they are, on their
     brand colour or white.
  3. **Gemini Flash-Lite judge:** one call per company with the framed candidates numbered on one image,
     plus the company name and domain. It picks the current main logo and rejects promo badges,
     sub-brands, text-only versions, outdated logos and anything clipped or off-centre.
  4. **Search fallback:** if nothing passes, Gemini with Google Search finds the official logo, which goes
     through the same framing and judge.
  5. **Fallback:** the first letter on `bg-secondary`. The fallback rate is tracked.
  6. **Review page:** owner only. It shows new logos, a reject re-runs the search without that one, and
     fixes apply to every user. Logos are rechecked every few months for rebrands.
  - Only company names and domains leave Konva, never addresses or mail. Tested on 72 sample companies
    (36 South African, 36 international) and the owner's own before rolling out.
  - **Rolled out 26 October 2026** at 4 of 180 companies on the first letter (2.2%), about $0.0012 a
    company in Gemini calls. `COMPANY_LOGOS=true` in both workers' `.env`.
  - **How the app finds a logo:** domains are sealed per user, so the sync worker points each company at
    its logo (`organizations.logo_path`, `20261031110000_organization_logo_path.sql`) after a logo
    changes and every six hours. The Companies list and page show it, or the first letter on
    `bg-secondary`; a company sender shows it in place of a photo. The old per-user icons
    (`organizations.avatar_path`) are no longer shown.
- **How it is built (26 October 2026):**
  - **One shared queue** in `company_logos` (`20261031100000_company_logos.sql`). The sync worker does all
    fetching, framing and storage (`apps/worker/src/logos`); the AI worker only calls Gemini
    (`apps/ai/ai/logos.py`), as every other AI call does. A company goes queued, judging, judged, then
    searching and round two only when nothing passed. Both sides are off until `COMPANY_LOGOS=true`.
  - **Storage:** the chosen logo is `<sha256 of the domain>.png` in a `logos` bucket every signed-in user
    can read, so file names do not list the companies people hear from. Candidates and the judge's
    sheets sit under `review/`, owner only.
  - **Sources:** up to 2 App Store apps (searched in ZA, then US; kept only when the publisher's site,
    bundle ID or name matches the company; one search every 3.1 seconds), BIMI, up to 4 site images (its
    icons, plus header images marked as a logo and its preview image, often a small company's only
    sharp logo), Wikidata (P8972, then P154, files without an end date; when it has none, the logo its
    English Wikipedia infobox names), Google's favicon service, and Simple Icons drawn in its brand
    colour. Wikimedia allows about 10 requests a minute without a contact address, so Wikidata waits 6.5
    seconds between requests. Duplicates are dropped; at most 10 candidates. Sites that turn the
    worker away are left alone; it never pretends to be a browser.
  - **Framing:** the safe circle is 76% of the avatar's width, measured by the mark's farthest visible
    pixel from the centre of its box, so wide and tall marks fit; round marks may be 15% larger. A white
    mark goes on the brand's colour (taken from another candidate) or near-black. A gradient app icon
    fills the circle unless sharp detail reaches the outer 16% of the radius in a few places, when it is
    drawn smaller inside a circle of its edge colour.
  - **Judge:** the fast model (`gemini-3.5-flash-lite`), low thinking, one sheet of numbered 160px circles
    plus where each came from. About 1,800 input tokens, about $0.001 a company.
  - **Search:** the fast model with Google Search grounding and no structured output (with it the model
    answered without searching). It works out the real company from a name made from a domain
    ("Workablemail") and answers with up to 6 addresses: images, or pages whose icons, logo images and
    Google favicon are tried. The second judging also sees the first round's candidates and is told it
    is the last look, so it settles for the best real logo (even a wordmark) rather than none. Grounding
    is free for 5,000 queries a month across Gemini 3 models, then $14 per 1,000.
  - **Cost** is Konva's, filed in `ai_usage` against the owner's account as `logos`.
  - **Review page:** `/analytics/logos`, linked from Analytics. Reject re-queues without that candidate
    (it is never offered again); Use This saves a candidate by hand and rechecks leave it alone. Logos are
    rechecked after 90 days.
  - **Fallback:** `CompanyAvatar` in `components/primitives.tsx`, the first letter on `bg-secondary`.
  - **Rollout, not done yet:** `pnpm --filter worker company-logos --from-orgs`, then the app reads company
    avatars from the `logos` bucket through `CompanyAvatar`, then `COMPANY_LOGOS=true` in both workers'
    `.env` and a restart. Until then the per-user logos below stay as they are.
- **Where logos came from (first version):** the company's own site first: every icon its home page and web app
  manifest name (apple-touch-icon, manifest icons, SVG icons, favicons), then `/apple-touch-icon.png`
  and `/favicon.ico`. When none is sharp enough, Google's public favicon service
  (`t1.gstatic.com/faviconV2`) is asked for the same domain. Only the company's domain is sent, never an
  address or any mail. No paid logo API.
- **Framing (first version):** every logo is made into one 256px PNG by the worker (`sharp`, the one new dependency): the
  mark is found inside its padding or tile, then set at the same size (about 62% of the circle) on its
  own brand colour, or on white (black for a white mark). Pictures with no plain background fill the
  circle. Icons too small to look sharp (under 48px, so 16px and 32px favicons) are never used: the
  plain circle shows instead.
- **Where they show:** the Companies list and page, and in place of a photo for a sender that writes as
  the company itself ("LinkedIn", "Dan from Relume"), so in the conversation list, the conversation and
  the contact page too. A sender whose name does not mention the company (mail sent through a hiring or
  mailing service) gets no logo.
- **Names:** an automated sender with no real name ("noreply", "No Reply", "Info") is named for its
  company, and a company named from its domain ("Linkedin") takes the spelling its own senders use
  ("LinkedIn"). Renamed companies are left alone.
- Existing data was refreshed once with `pnpm --filter worker refresh-company-logos`; after that the
  daily photo job keeps logos current (each company rechecked monthly).

### Onboarding

Decided 26 October 2026: as little friction as possible, nothing a new user needs is in the terminal, and the
selling points (drafts in your voice, one list across channels, contacts joined up) are shown, not skipped.
Both parts are dialogs over the app, so the app is there behind them as it fills up.

Sign up on `/login`: Continue With Google, or an email with a code (its link works too). No password to make
up. Accounts with a password can still use it.

Part A, the setup dialog (`components/onboarding/`), opens over the app for someone new and resumes where
they left off:

1. Connect: Google (Gmail and Calendar with one consent), WhatsApp (the QR code inline), iCloud (Mail and
   Calendar with one app-specific password, checked with iCloud before it is saved). Microsoft still links to
   its Settings page. The service that hosts your sign-in email comes first (from the address, or its MX
   records for your own domain), then WhatsApp. The workers start importing straight away.
2. About You, while the import runs: photo, name, what you do, and anything else Konva should know. The
   footer shows the import counting up.
3. What Konva Found: emails, WhatsApp messages, conversations and contacts brought in, and what the AI wrote:
   About You, How You Write and Who Matters Most. Each can be edited, or changed by saying what to change,
   before it is kept. Kept only into settings you have not filled in yourself.
4. Tidy Up Your Contacts: people Konva would merge, and one it would split, each a tap.
5. Try a Reply: a practice email and WhatsApp in a copy of the real reply box. Tap a choice, say what to say,
   write your own and use Edit Text, then Adjust. Nothing is sent.
6. Ready: what is set up, then Show Me Around or Start Using Konva.

Steps 3 and 4 drop out when no account is connected.

Part B, the page by page tour, was removed on 2 November 2026: the owner's rule is that onboarding shows value
in dialogs, not a popover tour. Settings, General, Getting Started runs the whole setup again. The setup dialog now
shows only real counts and contacts, labels its demo steps as examples, and saves nothing it made up.

For now steps 2 to 5 run on mock data (`lib/onboarding-demo.ts`): the import counts, the profile the AI
writes, the contact suggestions and the practice drafts. To make them real: the workers report import
counts, the AI worker writes the first profile during setup, the contact linker reports its suggestions,
and the practice reply calls the real drafting with a sample message. The profile photo is shown but not
saved yet.

How it works:

- Progress is kept in the sign-in's user metadata (`onboarding` holds the step, plus `tour`), so it follows you
  to every device. People from before onboarding have no flag and see setup only while they have no accounts.
- `/api/connect/google` and `/api/connect/icloud` save accounts exactly as the `pnpm connect:*` commands do.
  Google uses a separate Web application OAuth client (`GOOGLE_WEB_CLIENT_ID`), and its sign-ins are marked
  `client: "web"` so the worker refreshes them with that client. The worker starts a new account within
  seconds through Realtime instead of at its next 30-second pass.
- Events: `onboarding_step` and `tour_step`, content-free like the rest.
- Sign-ins now pass through the web app's server once, on their way to being stored encrypted. Like the key
  service, this moves into Confidential Space with the workers.
- Brand logos (Google, Microsoft, iCloud, WhatsApp, Gmail, Outlook) are small SVG files in
  `apps/web/public/logos`, from the official artwork, with no icon package.

#### Onboarding Flow: the /onboarding Page (28 October 2026)

A page of its own for joining, as a mock for now (`app/onboarding/page.tsx`, `components/onboarding/flow.tsx`).
It is one dialog on a `bg-secondary` page with nothing else on it: no close button, Escape and clicking outside
do nothing, so the only way out is through. It sits outside the app shell (no navigation, no sign-in
redirect) and everything on it is mock data that is saved nowhere.

Goal: from signing up to a useful Summary page in about three minutes, with every question either answered by
the import or skippable.

Six steps, each one screen (a Voice step was dropped on 28 October: Konva learns tone, length and sign-off
from sent mail and from the edits people make, so asking up front added a step without adding accuracy):

1. Welcome (join): no intro text. Continue With Google, Microsoft or Apple, or a name and email address with
   a code. A Set Up a Passkey switch lets someone sign in with Face ID, Touch ID or a device PIN, so no code
   is emailed each time. Mock for now: Microsoft and Apple sign-in and the passkey are still to build.
2. Connect: Google, WhatsApp (QR code inline), iCloud, Microsoft. "Do This Later" shows only while nothing is
   connected. "Skip, Do Later" shows only while nothing is connected. The first connection starts the import,
   which keeps running behind every later step, shown as "Processing" beside the step count.
3. About You: photo, what you do, anything else Konva should know. All optional.
4. What Konva Found: the totals, shown within seconds (for example 10,000 emails), with an honest estimate
   of how long reading them all takes (for example about 30 minutes). Nobody waits: Continue is always on,
   the last 30 days are processed first so Summary and Inbox are useful in minutes, and Konva notifies them
   when the rest is done and its profile (About You, How You Write, Who Matters Most) is ready to review in
   Settings.
5. Daily Brief: the brief time, spoken or not, and which notifications to get (urgent, midday digest).
6. Ready: what was set up in plain lines, then Show Me Around (the tour) or Start Using Konva.

Rules for every step:

- Back is always at the far left, except on the first step. Nothing is lost going back. There is no
  coloured footer bar: just the buttons.
- One decision per screen. Defaults are already the likely answer, so Continue is always enough.
- Without an account, step 4 says nothing is connected, and step 7 says what is missing.
- No dashes in the copy and Title Case on labels, as everywhere else.

Mock versus real, so that making it real touches only the data:

| Step | Mock now | Real later |
| --- | --- | --- |
| Welcome | Google button fills a sample name and email | `/login` sign-up, then this page opens once per new user |
| Connect | A timer marks the account connected | The existing `/api/connect/*` routes and WhatsApp link panel |
| Found | Fixed totals that count up in 2.5 seconds | Provider totals read at connect time (Gmail reports its message count at once) and a time estimate from the workers' measured pace; the first profile is written when processing ends |
| Brief | Local state | Profile and notification settings |

To finish: send new users here from sign-up, save the step in the sign-in's `onboarding` metadata so it
resumes on any device, record `onboarding_step` events, replace the two in-app flows (setup dialog and
tour hand-off) with this one, and move Tidy Up Your Contacts and Try a Reply in as optional steps once the
contact linker and drafting are connected. Estimated at one to two days of Claude-built work.

To set up before it works for someone new: a Web application client in Google Cloud with the redirect URI
`<origin>/api/connect/google/callback`, the same client as the Google provider in Supabase Auth, `/login`
in Supabase's allowed redirect URLs, `{{ .Token }}` in Supabase's magic link email template so the code
shows, and custom SMTP in Supabase (its own mailer sends only a few emails an hour).

## Teams

Decided 27 October 2026. The Team seat (R499 against R349) is paid for by the owner, not the agent, so
everything it adds is for the owner: keeping client history, seeing that clients are answered, and
running the team in one place. How It Is Built marks each step as it lands.

### What Teams Get

At launch:

1. The business keeps client history. When an agent leaves, their work chats stay, and the owner
   reassigns those clients to someone else.
2. Shared inboxes: info@ and sales@, a shared WhatsApp Business number and the business Instagram, with
   each conversation assigned to a person, internal notes, and a warning when someone else is replying.
3. Response tracking for the owner: unanswered client messages across the team and reply times per
   person. Counts and timings only, never message text.
4. One bill and seat management: invite and remove people, onboard 5 to 25 at once, pooled storage and
   AI allowance (see Fair Usage and Storage).

Soon after (built as step 6, see How It Is Built):

5. One company voice: a shared AI profile, templates and company facts (prices, listings, FAQs) used in
   every agent's drafts.
6. Cover: while someone is on leave, a colleague answers their work chats.
7. Compliance export: a per-client archive of WhatsApp and email for FAIS, legal and POPIA records.
8. Shared contacts and companies, so the team keeps one client list.

### Work and Personal Chats

Most agents run clients and family on one WhatsApp number, so sharing is decided per chat, not per
account.

- Everything starts private. Connecting a personal account shares nothing.
- A chat becomes a work chat in three ways: automatically, when the contact is in the team's shared
  contacts or belongs to a client company; by suggestion, when the AI thinks a chat is about work (only
  the agent sees it, and nothing is shared until they accept); or by hand, with Mark as Work on any chat
  or group.
- Only work chats are shared, and they are encrypted with the team's key. Personal chats stay under the
  agent's own key, and the owner never sees them, not even as counts.
- A work chat is read only by the agent whose chat it is and anyone it is assigned to. The Owner and
  Admins see that it exists (the client, the agent, reply times) and can assign it, but read the
  messages only once it is assigned to them. The agent always sees who else a chat is assigned to.
- The client shows up for the whole team on the Contacts page, with their company and the agent who
  looks after them. The messages stay with the chat.
- The agent always sees what is shared: a Work or Personal badge on every chat and a list of everything
  shared in Settings, Team.
- An agent can move a chat back to personal at any time. The owner sees only that it happened, as a
  count ("Sipho moved 12 chats to personal this week"), never which chats or what was in them. A
  stricter setting for regulated firms keeps a work chat shared until the owner releases it. It is off
  by default and switched on for FAIS and legal firms during onboarding.
- The strict setting also turns on a Compliance role, for the person who supervises client
  communication in a FAIS or legal firm. Compliance reads every work chat in the workspace, never a
  personal one. Agents are told about it, in plain words, before they join, and every chat Compliance
  opens shows in the agent's list of what is shared.
- Share From: when an agent marks a chat as work, they choose how much is shared: the whole history (the
  default), from today, or from a date. They see how far back it goes before confirming. Older messages
  stay under the agent's own key and nobody else sees them. With the strict setting on, the choice
  cannot be undone, and the dialog says so.
- A whole account the team owns (a shared inbox, the business WhatsApp number) is shared in full.
- The limit, said plainly: a client who has an agent's personal number can keep messaging them after
  they leave. Konva keeps the history and reassigns the client; only a number the business owns fully
  solves it, so Konva makes moving clients onto a shared business number easy, without forcing it.

### How It Is Built

**1. Workspaces and members.** Built 1 November 2026 (`20261101100000_workspaces.sql`, needs applying).
`organizations` already means client companies, so the team is a `workspace`.

- `workspaces` (the business name, which is account detail and not message content, the owner, seat
  count and the strict-sharing setting), `workspace_members`
  (role Owner, Admin, Compliance or Member; status Invited, Active or Removed; joined and left dates) and
  `workspace_invites` (an emailed link, stored as a hash, expiring in 7 days). One workspace per person.
- Approving a team request in `/admin` creates the workspace and invites its owner.
- Settings, Team: members, invite, remove and roles. Pooled storage and the AI allowance read the
  workspace's seat total.
- Billing stays manual (seats set in Admin) until Paystack billing is built, a separate piece of work.
- Built a little differently, and why:
  - No email is sent (nothing here sends email yet), so an invite gives the owner or admin a link to send by
    hand. It works once, only for the address it was made for, and the page it opens shows the plain-words
    consent before Join Team.
  - Members are not rows with status Invited: a pending invite is a row in `workspace_invites`, and the
    status stays in the list for later.
  - Only the owner makes, changes or removes an admin, nobody changes the owner, and anyone but the owner can
    leave. A pending invite holds a seat.
  - Approving a team request in `/admin` makes the workspace with the owner's invite, and shows the link once.
    `workspaces.waitlist_id` stops approving twice from making two teams, and New Invite Link in Admin, Teams
    makes another link for an owner who has not joined.
  - Pooling: `ai_allowance_for` counts every active member's spend against seats times the per-seat budget, and
    `my_team_storage` gives the team's bytes against seats times 20 GB for the meter in Settings, Usage. The
    storage cap itself is still not built, so the team's total only feeds that meter for now.

**2. The team key.** The same design as a user's data key, one level up. Built 1 November 2026; nothing
writes `t1:` until step 3.

- `team_keys` holds each workspace's 32-byte data key wrapped by the same wrappers as `user_keys`
  (`local:v1` now, Cloud KMS at privacy stage 3), with `team_keys:<id>` as additional data so a wrapped
  key cannot be moved to another workspace. The key is made on first use, insert-if-absent, so racing
  processes keep the first. User wrapping is unchanged, bytes and additional data (`user_keys:<id>`).
- Its field and blind-index keys are derived with the same HKDF-SHA256, under their own info strings,
  `messages/team-field-encryption/v1` and `messages/team-blind-index/v1` (a user's are
  `messages/field-encryption/v1` and `messages/blind-index/v1`), so a team key can never be mistaken for
  a user key and a team's index of a value never equals a user's. A new prefix, `t1:`, marks a value
  sealed with the team key, with the same layout and the same field-kind additional data as `e1:`;
  `e1:` stays the user's key. `isCiphertext` is true for either prefix. Readers choose the key by the
  prefix (`decryptAny`, `decrypt_any`), and the row's `workspace_id` says which team; a `t1:` value read
  without team keys is an error, and shows as empty in the apps. Team blind indexes use the same address,
  chat and domain normalisation as a user's. The TS and Python helpers and `vectors.json` have the `t1:`,
  team index and team wrap cases.
- The key service gives a member the team key only while they are Active (`team` in the `/api/keys`
  reply, none otherwise). A removed member's browser drops its cached team data on the next load. The
  sync worker and the AI worker get a workspace's keys from `team_keys` and cache them like user keys.
- Until Confidential Space (stage 4) this has the same footing as user keys: whoever holds the wrapping
  key and the database could read it. The privacy copy must say so.

**3. Sharing a chat.** Built 1 November 2026 (`20261101120000_shared_chats.sql`, needs applying).

- `threads` gains `workspace_id` (null for personal), `shared_at`, `shared_by` (rule, suggestion,
  agent or account) and `share_from` (null for the whole history). Messages, message AI, attachments, transcripts and summaries of a shared thread
  carry the same `workspace_id`.
- Marking a chat as work queues a job: the sync worker re-encrypts the chat from its Share From date
  (the whole history by default) from `e1:` to `t1:`, adds team blind indexes beside the agent's own, and copies its people into the
  shared contacts. Moving it back runs the same job the other way. Drafts and the agent's own notes stay
  under their key.
- Row level security adds, beside "Own rows", a read policy for shared rows: the agent whose chat it is
  and anyone it is assigned to. Owners and Admins get a list of the workspace's work chats (client,
  agent, timings, no content) through a function, and can assign any of them, themselves included.
  Compliance reads every work chat while the strict setting is on. Messages older than a chat's Share
  From date keep no `workspace_id`, so the policy never reaches them.
  Writing stays with the agent, except an assignee replying.
- `workspace_activity` records content-free counts per member per week (chats shared, chats moved back).
- Thread header and list: a Work or Personal badge, Mark as Work and Move to Personal, all under the
  strict setting where it is on.
- Built a little differently, and why:
  - The chat is work at once (`threads.workspace_id`, so access starts and stops with the click) and its rows
    follow: the worker seals a row and stamps its `workspace_id` in one write, so a row is never in a workspace
    without being `t1:`. Moving back cuts every policy at once (`can_read_thread` checks the chat is still shared)
    and ends its assignments, then the worker seals the rows with the agent's key again.
  - New content in a shared chat is written `e1:` by every writer, as before, and triggers queue a follow-up job
    for the chat (one waiting at a time): a message, a late transcript, triage's summary, a rewritten preview, a
    new file. Writers did not change. Nothing is queued once the agent has left the team, so what they write after
    that stays `e1:` with no `workspace_id`, and what was shared stays shared. Their chats cannot be moved back.
  - Jobs are claimed with `claim_share_job`, one per chat at a time, a crashed worker's after 10 minutes, a failed
    one up to five times. The worker writes through `share_write`, which only changes a row that still holds what it
    read and only while the chat is in the state the job is for, and goes round until a pass finds nothing.
  - Attachment files are not re-sealed: received files are stored as the provider sent them today, so there is no
    team form of them yet (no team sealed-file helpers). Their rows get the `workspace_id`, and a storage policy lets
    an assignee read them. Meetings and their transcripts do not hang off a chat and are left alone.
  - The chat and participant IDs in `provider_meta`, and `provider_thread_id`, stay `e1:`: the worker needs them to
    send. Readable addresses stay readable until `ENCRYPT_ADDRESSES` is on. A chat shared from today or a date keeps
    its older preview and summary under the agent's key until a shared message replaces them; its subject is
    sealed, because it names the chat.
  - Strict sharing: only an owner or admin releases a chat, and counts it as moved back for the agent. A readable
    `workspace_activity` is there for the owner (counts only), with no screen yet.
  - Readers that do not select a row's `workspace_id` try the user's own workspaces for a `t1:` value (the sync worker
    and the AI worker both do), so no reader needed changing. The app's lists ask for their own rows with
    `user_id`, so an assignee's or Compliance's inbox never fills with colleagues' chats.
  - Built in step 5 below: the assignee's own view of a chat, replying, the owner's list and counts on screen, and the chats
    Compliance opens showing in the agent's list. An assignee writes nothing in the agent's rows, so there are no write
    policies for them.

**4. Automatic sharing and suggestions.** Built 1 November 2026 (`20261101130000_team_contacts.sql`, needs applying).

- `workspace_contacts` is the shared client list, matched by team blind indexes, and shown to every
  member on Contacts with the client's company and their agent. Contacts in any shared
  chat join it.
- On ingest the worker also works out each sender's team index. A match with a shared contact or a client
  company's domain shares the chat, and the agent is told, with a way to move it back.
- Suggestions use triage's existing `category` (work or personal), shown to the agent only.
- On joining a team, a one-time review dialog lists the chats Konva suggests as work, for the agent to
  accept or skip in one go. Classifying reads only what is already synced, so nothing opens a chat on the
  phone or sends a read receipt.
- Built a little differently, and why:
  - One sweep does both jobs, in the sync worker, every 3 minutes (`apps/worker/src/share/rules.ts`), instead of
    working out indexes on ingest: it touches no connector and one place decides. For each active member it reads
    their personal chats active in the last 30 days that nothing has decided, works out the team index of each
    person in them and matches the client list and the client companies; then it suggests chats triage marked
    `work` from the last 90 days (`suggest_work_chats`). The AI worker is not involved. A workspace with no
    clients yet is not read for the rule at all.
  - Strict sharing on: a match only sets `share_suggestion = 'suggested'`, because accepting is irreversible
    under strict and the agent must choose. Off: `apply_team_rule` shares the whole history at once
    (`shared_by` rule) and the thread header says "Shared because Acme is a team client" with Move to Personal.
    `threads.share_match` holds that name, sealed with the team key.
  - A chat moved back to personal sets `share_opt_out`, so a rule never shares it again, and a suggestion
    answered Not Work is `dismissed`, which the rule respects too. Groups are never shared by the rule, and can be
    suggested by the category. A suggestion stays until the agent answers it (it is not withdrawn if triage later
    changes its mind). A chat the agent accepts from a suggestion is recorded as `shared_by` suggestion.
  - The client list is filled in the worker when a `to_work` share job finishes (`clients.ts`), best effort: a
    failure is logged and the chat stays shared. It skips the agent's own addresses and every colleague's, the
    team's own domains, personal mail domains (no company), placeholder names and role addresses (noreply@,
    info@: they are left out of the client's addresses so they never match unrelated senders). A group of more than
    10 people is not added, because its members are a community and not all clients. The first name a client
    was added under stays; a client is the oldest one holding any of the addresses, so two agents' contacts for
    one person become one client with both as agents. `workspace_contact_agents.left_team` follows the member's status.
  - Every client company is a client company: anyone at that domain matches, so one shared chat with someone at
    a firm shares the others at that firm. An owner or admin can remove a client or company from the list (step 6).
  - Contacts shows a Team Clients row above People for members, opening `/contacts/team`: names, companies and who
    looks after each client, no messages. The page has no link to a chat. Assigned chats are in the assignee's Inbox (step 5).
  - The review dialog (`team-review.tsx`) opens for someone who joined in the last 14 days and has suggestions, after
    setup and the tour, and is remembered in the sign-in's metadata (`teamReview`, the team it was answered for).
    Chats start unticked: nothing is shared until the agent chooses, with Select All and one Share From for all.
  - The notice is its own component under the thread header (`share-notice.tsx`), because the header's flex row is
    where the Work badge lives; the badge still opens the same Mark as Work and Move to Personal dialogs.

**5. Owner features at launch.** Built 3 November 2026 (`20261103100000_team_owner_features.sql`, needs applying).

- Reassigning a client: `thread_assignments` gives another member a departed agent's work chats. The
  chat cannot move to their number, so the client's timeline joins the old history with the new agent's
  own conversations under the one contact.
- Shared inboxes: accounts get `workspace_id`, connected by an Owner or Admin and shared in full.
  Assignment, internal notes (team key) and "Thandi is replying" through Realtime presence.
- Response tracking, Team, Activity: unanswered work chats and median first reply time per member, from
  timestamps on work chats only.
- Built a little differently, and why:
  - An assignee never writes in the agent's chat. They answer from their own connected account, as a new email or
    WhatsApp conversation through the usual outbox path, with `outbox.for_thread_id` naming the chat (only an
    assignee may set it, never Compliance). The worker links the sent conversation as it always does, so the
    assignee's page shows both in one timeline, and an answer sent this way counts as the chat being answered. When the
    client writes back to the assignee, the step 4 rule shares that chat as the assignee's own work chat, so one
    client has two agents. Email and one-to-one WhatsApp only; a group is not answered this way.
  - Assigned chats are a group above the person's own conversations in the Inbox, "Assigned To You" with the agent's
    name, not rows in their own list, so nothing of a colleague's reaches their own store. They open read-only at
    `/inbox/shared/<id>` with notes and the reply box. Compliance is never assigned.
  - Work Chats is Settings, Team, Work Chats, for an owner or admin and for Compliance under strict sharing: the step 3
    `work_chats()` with filters (all, agent has left, awaiting reply, not assigned), who looks after each, Assign To and
    Take Back From, and Reassign All for someone who has left. An owner or admin opens a chat only once it is
    assigned to them. A chat counts as awaiting reply until the client's last message has an answer, including one an
    assignee sent from their own account.
  - The Compliance log gates reading: a Compliance member reads a work chat only for 4 hours after
    `log_compliance_open` wrote their row, so skipping the screen cannot skip the log. Only the agent reads a chat's log,
    and What You Share says "Opened by Compliance on <date>" (the last five days). Assignees, admins and the owner are
    not logged.
  - A shared inbox is made from an account an Owner or Admin has already connected (Settings, Team, Shared Inboxes), not
    by a choice inside each connect flow, which stay as they are. The whole history is shared at once and new chats are
    shared as they are created. Its chats cannot go back to personal, and whoever connected it cannot be removed or made
    Compliance while it is shared. Email and WhatsApp accounts only.
  - Who uses an inbox is an access list the owner or admin sets: those on it read every chat, assign one person at a
    time, add notes and reply from the shared account (their name on the sender line, text only, no Cc or attachments
    yet). An owner or admin not on the list reads nothing. Presence is a private Realtime channel per chat, joined only by
    people who can open it. People who write to a shared inbox are not added to the team's client list.
  - Notes are `thread_notes`, sealed `t1:` (the table insists), read by whoever can read the chat, never sent. Compliance
    reads them and does not write them.
  - Activity (Settings, Team, Activity): per person, unanswered work chats and the median time from a client's message to
    the first answer, over 7 and 30 days, from message times alone, plus the weekly counts of chats shared and moved back.
    A shared inbox chat counts for whoever it is assigned to, and for "Not Assigned" otherwise. Personal chats are not in
    any query.
  - Not built: taking a shared inbox back out of the team, files and Cc on a shared inbox reply, and a shared inbox for
    Instagram, LinkedIn, Teams, Zoom and Google Chat.

**6. Soon after.** Built 4 November 2026 (`20261104100000_team_after_launch.sql`, needs applying). Company voice, cover,
the compliance export and the shared contacts page.

- Company voice (Settings, Team, Company Voice): a profile (tone, sign-off, things to always say and never say), templates
  (a name and a body) and company facts (a title and a body), all sealed `t1:` in the browser. Every active member reads
  them, only an owner or admin writes them. The AI worker reads them with `company_voice_for_draft` for a draft in a work chat
  or a shared inbox chat, under the agent's own style, and never for a personal chat. Templates are inserted from the reply
  box. No new model call: the text is part of the draft's prompt, so it is billed and counted against the allowance as any
  draft is.
- Cover: an owner or admin sets a period for any member, and a member for themselves: who is away, who covers, the first and
  last date. While it runs the covering member reads the absent member's work chats as if assigned and answers from their own
  account (the step 5 path). It ends by itself on the last date, or early, or when either person leaves the team.
- Compliance export: with strict sharing on, only Compliance exports one team client's work history (decided 27 October 2026,
  so an export is never a way for an owner or admin to read a chat not assigned to them): every work
  chat with them across agents and shared inboxes, email and WhatsApp, with dates, senders and text, and the team's notes. The
  browser opens the `t1:` values and builds the file (a readable HTML document that prints or saves as a PDF, and a JSON copy).
  Each export is a content-free log row.
- Shared contacts page: an owner or admin renames a client, sets or clears their company, changes who looks after them, merges
  two clients, and removes a client or a client company from the list. Members keep the read-only list.
- Built a little differently, and why:
  - The voice is one table (`workspace_voice_items`, kind profile, template or fact) and reuses the field names that already
    exist (`style_rule` for the profile, `writing_situation` and `writing_body` for templates, `note_title` and `note` for facts),
    so the crypto package needed no new field kind. The app and the AI worker open each part with the same name.
  - What stops the voice reaching a personal chat is the database: `company_voice_for_draft` returns nothing unless the chat
    has a workspace and the person is an active member who is its agent, assigned to it or covering for the agent. The AI worker
    only asks when the person is in a team (no extra round trip for anyone else), and uses an answer with no workspace as none.
    Edits, adjustments and new messages do not use it. The voice sits after the agent's own rules and facts and before their
    examples, and the system text says the agent's style wins on wording and the company's rules and facts win on content.
    It is capped (profile parts 600 characters, 12 always or never lines of 200, templates 600 each and 3,000 together, facts
    500 each and 4,000 together), so it adds a bounded cost to every work-chat draft. The shared chat page has no draft button,
    so for now only a chat's agent drafts there (the agent of a shared inbox chat is whoever connected the account).
  - Cover is a dated table (`workspace_cover`) and not rows in `thread_assignments`: `can_read_thread` and `is_assignee` ask
    `i_cover`, which compares the dates with the clock. A new chat of the absent member is covered at once, and the end needs no
    job. A chat of a shared inbox is not covered this way, because the inbox's access list decides who reads those. Covered chats
    are in "Assigned To You" marked "(covering)". The absent member sees who covered and when in What You Share, and not
    what was read. "Allow cover to reply from my number" is stored (`workspace_members.allow_cover_reply`, off, set only by the
    member) and used by nothing: sending as another person's account needs the worker's send path and its own checks, so cover
    always answers from the covering member's own account and the app has no switch for it yet.
  - The export reads through its own functions and not the step 3 policies, so it is held to its own log. `begin_client_export` writes the log row first and each read needs that row open (six
    hours, one client, the chats it listed), so an export cannot skip the log. Compliance does not need a Compliance open row
    for each chat. Nothing before a chat's Share From date and no personal chat is ever returned, and a message the worker has
    not sealed yet is left out and the file says how many. Attachments are listed by name, not copied.
  - Which chats are with which client is `workspace_contact_threads`, filled by the sync worker when a chat is shared (the same
    team blind indexes that match the client list; no content, no policies). A shared inbox chat is linked to the clients the
    list already has but never adds one. A chat shared before this migration is linked the next time something arrives in it.
    A chat with someone who is not on the client list is not part of any export.
  - Each agent is told which of their chats an export included, by day, in What You Share. The log itself is read by owners and
    admins (Compliance reads its own). The invite's consent text says covering and exports.
  - Removing a client or company records its indexes in `workspace_client_exclusions` and `upsert_workspace_contact` skips them,
    so the worker does not add them back; no chat is unshared. A company typed by hand is a label on that client and makes no
    rule: only a company already on the list can be joined. Change Agent changes the name on the list and moves no chat (Work
    Chats does that). A merge keeps the first client's name.
  - The team key rotation re-seals these too (`rotate-voice.ts`): the voice, the export log's client names and the team's notes
    on a chat. The notes were missing from it, and a retired key version would have taken them with it.

**POPIA.** The business is the responsible party for work chats. Joining a team shows the agent, in plain
words, what is shared and what stays private, and they accept before anything is shared. Personal chats
are never processed for the business. The Privacy Policy gains a Teams section.

**Checks.** Crypto vectors for `t1:`; row level security tests that a Member can never read a colleague's
personal or unassigned chat and an Owner never a personal one; a round trip of work to personal and back
that leaves every field readable; two test users in one workspace. Nothing is sent while testing.

### Build Order and Time

Claude-built time, before the owner's review and testing:

| Step | What | Time |
| --- | --- | --- |
| 1 | Workspaces, members, invites, Settings, Team | 1 to 2 days |
| 2 | Team key, `t1:` in TS and Python, key service | 1 to 2 days |
| 3 | Sharing a chat, re-encryption job, row level security, badges | 2 to 3 days |
| 4 | Shared contacts, automatic sharing, suggestions, the review dialog | 2 days |
| 5 | Reassigning, shared inboxes, response tracking | 3 to 4 days |
| 6 | Company voice, cover, compliance export, shared contacts page | 3 to 5 days |

About 2 to 3 weeks in all; steps 1 to 5 are the launch set. Steps 1 and 2 can be built side by side.
Paystack billing is separate.

Code check (4 November 2026): all six steps are written (`20261101100000_workspaces.sql` to `20261104100000_team_after_launch.sql`).
None of the Teams migrations is applied to the live database yet, and nothing has run against real mail. Steps 3 to 6 need the
sync worker running to seal shared chats and fill the client list. The team key is rotated when a member is removed (Security
and Cost Review, item 6).

### Decided (27 October 2026)

1. A work chat is read only by its agent and whoever it is assigned to. Owners and Admins see that it
   exists and assign it, and the client is on everyone's Contacts page.
2. The strict setting is off by default and on for FAIS and legal firms.
3. When a chat becomes work, its whole history is shared by default (see 6).
4. The Team plan has a minimum of 5 seats.
5. The strict setting adds a Compliance role that reads every work chat, never a personal one.
6. Share From: the whole history by default, or from today or a date, chosen when a chat becomes work.
7. Only Compliance exports a client's work history; owners and admins see only the export log.
8. Only the owner gives or takes the Compliance role and changes strict sharing.

### Review Fixes (27 October 2026)

A review of the Teams permissions found these, fixed in `20261105100000_team_review_fixes.sql` (checked in a scratch
database, with steps 5 and 6 rechecked on top of it):

- Share From: a message older than its chat's Share From is never read through a team policy, even if it still holds
  the team key from an earlier share, and a chat cannot be shared again while it is still moving back to personal.
- Admins could make someone Compliance and so read every work chat. Now only the owner can, as decided above.
- A match on a client company's domain only suggests a chat. Only a client's own address or number shares one by
  itself, because anyone at a client company (a bank, a medical aid) may be a personal contact.
- A departed agent's chats are shown to the team as they stood when the agent left: colleagues no longer read the raw
  chat row (or get it over Realtime), and the lists use the last shared message for the time and whether the client is
  waiting, never what the agent's own account keeps writing to it.
- Turning an account into a shared inbox also takes its chats already shared as work chats.
- The team read policies look up the reader's workspace once per query and skip the reader's own rows before the
  per-row checks.

Noted, not changed: every active member's browser holds the team key, which opens every `t1:` value in the workspace.
So "only the agent and whoever it is assigned to read a work chat" rests on row level security, not on encryption: a
future policy or function mistake that returns a colleague's rows would expose them in plain text. The privacy copy
must say team chats are protected by access rules within the team. If that is not enough later, a key per chat,
wrapped for each person allowed to read it, would make the key itself follow assignments.

## Privacy and Encryption

The aim: nobody running Messages, including us, can read what users send and receive. The only data
we look at is usage: which features are used, how often and how long tasks take.

### Code Check (27 October 2026)

This section was checked line by line against the code. The aim above is **not met yet**. Where the
rest of this section says "done", read it with these corrections. Fixes were written the same day: see
Build Status in the Security and Cost Review section below. Nothing is live until the migrations are applied and the scripts run.

- **Encryption is off unless switched on.** Every flag reads `=== "true"`, and the `.env.example` files
  ship `ENCRYPT_CONTENT=false`. The worker example has no `ENCRYPT_ADDRESSES` line, the web example has no
  `NEXT_PUBLIC_ENCRYPT_ADDRESSES` line, and the AI example leaves `ENCRYPT_ADDRESSES` empty (off). It is on only
  in the owner's local env files. A deploy built from the examples would store plaintext. Fix: make the
  flags default on, and refuse to start in production with them off.
- **Still stored as readable text:** `writing_examples` (situation, body), `style_rules` (rule,
  relationship), the contact fields company, role, relationship, style note and AI summary,
  `attachments.filename`, `calendar_events.title` and `location`, `address_book_cards.name`,
  `meeting_participants` names and addresses, `push_subscriptions`, and the `error` columns on
  `email_originals` and `briefs`.
- **Search vectors are plaintext.** `message_embeddings.embedding` is a plain `vector(768)`, because
  `similar_replies` compares vectors inside SQL. A vector leaks the meaning of the message. It is
  service role only, but anyone who can read the database can read it. Options: search in the
  Confidential Space worker instead of SQL, or stop using vectors and rely on the encrypted browser cache.
- **Files are sealed on the way in.** Attachments saved through `apps/worker/src/file-store.ts` (email, WhatsApp, the
  catch-up passes) are sealed with the user's data key before upload when `ENCRYPT_CONTENT` is on, as are note files,
  brief audio and draft voice instructions. A sealed photo or PDF gets a small sealed thumbnail beside it (the first page
  for a PDF), so tiles never download the whole file, and the worker backfills thumbnails for older files. Files stored
  before sealing began stay raw until re-sealed, and Instagram media and Zoom recordings may still be raw; Storage RLS
  keeps users apart, but the operator can read those. A sealed file is one encrypted block, so the browser opens it whole:
  on an iPhone or any device with little memory a sealed file over 20 MB is not opened (it says so) rather than risk the tab.
- **Connector sign-ins use one static key.** WhatsApp, iCloud, IMAP, Instagram and LinkedIn credentials are
  sealed with `ENCRYPTION_KEY` directly: no per-user key, no extra context binding, and the same value in the web
  app, sync worker and AI worker. One leaked variable opens every user's connected accounts. This is
  weaker than the message encryption and the plan did not say so.
- **KMS does not exist in code.** `packages/crypto/src/wrap.ts` defines only `local:v1`. There is no
  `kms:v1`, no Google Cloud SDK and no Confidential Space image. Stages 3 and 4 are not started.
- **Team keys are not rotated.** A removed member stops getting the key from `/api/keys`, but the key
  itself is never replaced, and the "re-encryption job" in Teams step 3 does not exist. Anyone who kept a copy can
  still open shared `t1:` data.
- **Stored HTML.** `messages.body_html` was never dropped. A one-off script
  (`drop-stored-html.ts --apply`) empties it, and existing rows keep their HTML until it is run.

### Where It Stands

- Message text, subjects, previews, summaries, drafts, quotes and the outbox are encrypted field by
  field with AES-256-GCM, under a data key per user (stage 1, partly done: see the Code Check above
  for what is missing and for the flags that default to off).
- Each data key is stored wrapped in `user_keys`. For now the wrapping key is `KEY_WRAPPING_KEY` in
  the workers' and web app's environment (`local:v1`), so whoever holds that key and the database can
  still read everything. Cloud KMS and Confidential Space close that gap.
- New email HTML is kept encrypted for about an hour and then deleted, and View Original fetches it from Gmail or iCloud when opened. Older rows keep `messages.body_html` until `drop-stored-html.ts --apply` is run.
- Accounts connected in the app send their sign-in through the web app's server once, where it is encrypted
  with `ENCRYPTION_KEY` before it is stored (see Onboarding), the same footing as the key service.
- Email addresses, phone numbers, WhatsApp chat IDs, company domains, reaction keys and outbox
  recipients are encrypted when the flags are on, and the database matches on their blind indexes (stage 2, code written;
  readable columns not dropped). `ENCRYPT_ADDRESSES` and `NEXT_PUBLIC_ENCRYPT_ADDRESSES` are on only in the owner's local env, and
  default to off everywhere else.
- Still readable, for a later stage: contact and company names (some are a number or an address,
  because that was all that was known), the author names on WhatsApp quotes, calendar attendees,
  email Message-IDs and References, and your own number while WhatsApp is linking.

### Stages

1. Message text encrypted (code written, off by default, files and some fields not covered: see Code Check).
2. Blind indexes (code written, readable columns not dropped, names and other fields not covered): email addresses, phone numbers and WhatsApp IDs stored encrypted, with a keyed
   HMAC beside each one so the database can still match a sender to a contact without reading it.
   Names, contact notes and domains are encrypted the same way. See Stage 2 in Detail below.
3. Cloud KMS: data keys wrapped by a key in Google Cloud KMS instead of `KEY_WRAPPING_KEY` (code written 27 October 2026, `kms:v1`; the Google Cloud key and the rewrap script run are still to do).
4. Confidential Space: the sync worker, the AI worker and the key service run in Google Confidential
   Space, and KMS only unwraps keys for those attested images.
5. Encrypted browser cache and client-side search (can run alongside stage 4).
6. Content-free analytics (can run alongside stage 4).

### Stage 2 in Detail

Every address-like value gets a blind index: an HMAC under the user's index key of the value written
one standard way (`packages/crypto/src/addresses.ts` and the Python mirror, pinned by the shared
vectors). An email is lowercased, a number is E.164, a lid is `<digits>@lid`, and each kind is
prefixed so an email and a number never share a token. The database matches on the index only. The
readable value is stored encrypted next to it.

What gets an index and is encrypted:

- `contact_identities.value`, `messages.sender_address` and `to_addresses`, `unsubscribes.sender_address`
  and `priority_rules.target`.
- WhatsApp chat IDs in `threads.provider_thread_id`, and the JIDs in `provider_meta` (chat, participant,
  reaction keys).
- `organizations.domain`, plus the user's own addresses in `accounts`, which are used to leave their
  own domains out of companies.
- Encrypted with no index, because nothing matches on them: contact and company names,
  `calendar_outbox.attendees`, outbox recipients, and the emails and numbers on address book cards.
  `calendar_events.attendees` is planned for this list but is stored readable today (only the title and location are
  sealed): the worker, the page and the update trigger read it as plain JSON. Sealing it is a stage of its own.

Code check (27 October 2026): no readable column was dropped. The index columns were added beside the
readable ones, and the backfill script re-encrypts values in place and only runs when someone runs it with the
flag on. The ingest functions still accept calls without indexes and match on readable values, so a plaintext path remains.
The index columns are nullable. The cryptography itself (HMAC-SHA256, a separate per-user index key) is correct.

What moves out of SQL: the database can no longer lowercase, split or pattern-match these values, so
the work that did is done by the sync worker (or the browser, which holds the same keys) before it
writes:

- Working out a company from a domain, including the personal-mail list and the user's own domains.
- Checking an address or number is valid.
- Name fallbacks such as using the number when there is no name.
- Spotting placeholder names.

`ingest_email`, `ingest_whatsapp`, `whatsapp_contact`, `whatsapp_map_lid`, `create_contact`,
`import_address_book_cards`, `merge_contacts`, `split_contact` and the company trigger are rewritten
to take indexes and ciphertext from the caller.

Rollout, in the same safe order as stage 1:

1. Add the index columns beside the readable ones, with nothing removed.
2. Writers fill both.
3. A backfill indexes existing rows.
4. The SQL functions switch to matching on indexes.
5. Readers accept ciphertext.
6. A backfill encrypts the readable values, and `ENCRYPT_ADDRESSES` switches on.

Each step can be checked before the next starts.

Left for later: email Message-IDs and References, which contain the sender's domain. Threading
matches on them, so they would need indexes of their own.

How it was done:

- The rules for writing a value one standard way are in `packages/crypto/src/addresses.ts`, with
  the Python copy checked by the shared vectors. The company rules are in
  `packages/email-text/src/company.ts`.
- The sync worker's address indexer fills any missing index every 30 seconds. A changed value clears
  its index (`clear_stale_address_index`), so nothing is left matched on a stale one.
- The ingest and contact functions take indexes and ciphertext from their callers. A call without
  indexes still matches on readable values, so the old and new code could run side by side during
  the switch.
- Readers in the web app, the sync worker and the AI worker open addresses wherever they load them
  (`openAddresses`).
- The backfill script, `apps/worker/scripts/encrypt-addresses.ts`, has a `--decrypt` way back. Its
  temporary write function was dropped after it ran (20261025001300).

Next, for names: encrypt contact and company names with the name field and a placeholder flag set
by the writer, so the database no longer needs to read names to tell a real one from a number.

### Google Cloud KMS

- A Google Cloud project of its own, `messages-keys`, holding only the key ring and nothing else,
  with as few people able to change its IAM as possible. Billing and audit logs stay on.
- One key ring, `messages`, in `africa-south1` (Johannesburg) to keep keys in South Africa for POPIA,
  if HSM keys and Confidential VMs are offered there by then (otherwise the nearest region that has
  both, with the workers in the same region), with one symmetric key, `user-data-keys`, protection level HSM. Rotate it yearly. Old versions stay
  enabled so existing wrapped keys still open, and keys are rewrapped under the new version in the
  background.
- A new wrapper, `kms:v1`, beside `local:v1` in `packages/crypto/src/wrap.ts` and the Python mirror.
  It calls KMS Encrypt and Decrypt with the user ID as additional authenticated data, so a wrapped
  key cannot be moved to another user. `wrapped_by` in `user_keys` records which wrapper made each
  row.
- Unwrapped data keys stay in worker memory only, cached for a short time (about 10 minutes), and are
  never written to disk or logs.
- Migration: a one-off script unwraps each key with `local:v1` and rewraps it with `kms:v1`. The data
  keys themselves do not change, so no message is re-encrypted. Once every row is `kms:v1`,
  `KEY_WRAPPING_KEY` is deleted from every environment and from the backup copy.
- Key destruction has a 30-day scheduled delay in KMS. Deleting a user's account deletes their
  `user_keys` row, which leaves their messages unreadable even in database backups (crypto-shredding).
- Cost: a few dollars a month for the key, plus about $0.03 per 10,000 operations. Caching keeps the
  operation count low.

KMS alone moves the secret out of `.env` files, but whoever runs the workers can still ask KMS to
unwrap keys. Confidential Space removes that.

### Google Confidential Space

- The sync worker, the AI worker and the key service (today `/api/keys` in the web app) are built as
  container images and run on Confidential VMs (AMD SEV) with the Confidential Space image. Memory is
  encrypted by the CPU, and the operator cannot SSH in, attach a debugger or read the container.
- At boot the VM gets an attestation token from Google that names the exact image digest, that it is
  the production Confidential Space image, and that debugging is off.
- A workload identity pool in `messages-keys` trusts only those tokens. The KMS Decrypt permission is
  granted to the pool on condition of the expected image digests and
  `support_attributes` containing `STABLE`. A laptop, a debug image or a changed image gets no keys,
  even with our credentials.
- The browser's key service moves into Confidential Space too. It checks the user's Supabase session
  and returns their data key over TLS that ends inside the enclave. The web app on Vercel never sees
  the key.
- Releases: images are built by a pinned CI pipeline from a tagged commit. Each release publishes the
  image digest and the commit it was built from, so anyone can check what is running against the
  source. Changing the allowed digests in the KMS policy is the only way to ship, and every change
  shows in the audit log.
- Outbound traffic from the workers goes only to Gmail, iCloud, WhatsApp, Supabase, KMS and Vertex
  AI. Logs leave the enclave only as counts and timings, never content.
- Gemini is called through Vertex AI in the same Google organisation, under terms with no training and
  no retention.
- Running cost: a small Confidential VM (n2d-standard-2) for each worker, roughly $70 to $100 a month
  each before committed-use discounts. The free Supabase plan and Vercel stay as they are.
- What it does not protect: a user's own browser, and Google itself, which we trust for KMS and the
  attestation service.

### Deleting an Account and Downloading Your Data (Wave 4, 2 November 2026)

POPIA gives people the right to see and to delete what is held about them. Settings, Profile and Privacy now has all of it:

- **Download My Data** builds a zip in the browser, opening everything with the person's own key, so the server never holds
  readable text. One JSON and one readable text file per conversation, contacts as CSV and vCard, notes as Markdown, tasks as
  JSON, events as ICS and JSON, and the profile and AI settings (never credentials). Files are optional and come with a size
  estimate. It shows progress, can be cancelled, and says it may take a while. The zip library is fflate, pinned exactly.
- **Disconnect** (per connected account) stops syncing and drops the stored sign-in but keeps every message. **Remove** also deletes
  that account's threads, messages, files in storage and derived rows, after typing REMOVE. A file shared by another account
  of the same person (deduped by content) is kept until nothing points at it. The worker does the deleting from a queued
  `account_removals` row (`request_account_removal`).
- **Delete My Account** needs a re-authentication (authenticator code if one is set up, else password, else a code emailed to
  them) and the typed word DELETE. It starts a **7 day grace period** shown as a banner with Cancel; after it the worker
  stops syncing, deletes the team copies of their shared files and everything under their folders in storage, deletes their
  wrapped key (crypto-shredding), removes any team they own with no other members, then deletes the auth user, which cascades
  to every `user_id` table. It then counts rows in every owned table and fails the job if any remain. A team owner with other
  members must hand the team over first. A test reads the migrations and fails if a new `user_id` table is not in the
  deletion list or does not cascade from `auth.users`.
- **Sign Out Everywhere** is Supabase's global sign out; the active sessions list shows a browser label and last use only.
- Not done: revoking the Google and Microsoft refresh tokens at the provider, and logging a WhatsApp linked device out, when
  an account is removed or deleted. The stored copy is deleted, so Konva can no longer use them.

## Product Analytics

Built (October 2026). This is privacy Stage 6 in detail. Everyone's app and both workers record the events
below, and the Analytics page in the rail (above Settings) shows them to mattprowse03@gmail.com only.

### Rules

- Content-free. An event holds a name, a time, a coarse screen and small allow-listed values: numbers,
  durations, yes/no and a fixed list of words. Never message text, subjects, names, addresses,
  numbers, search words or anything typed. Search logs the length of the query, not the query.
- The event types are in code (`packages/analytics/src/index.ts`) as a map from name to its values. The
  database then keeps only numbers up to a billion, yes/no, and plain code words (lowercase letters, digits
  and `_ . : -`, starting with a letter), so a name, an address, a subject or a sentence cannot be stored
  even by a bug. Text is dropped, never tidied into a word. Checked in
  `analytics_clean_props` and tested against real inputs.
- The user is a keyed hash of their ID (the key sits in a table nobody can read), no IP address, no
  third-party script.
- Stored in our own table, `analytics_events`. The web app writes through `track()` (a database function
  that checks the Share Usage Data switch); the workers write through `analytics_record`, service role only.
  Only the owner account can read the table (policy on the stored owner user ID, with a confirmed email), and no signed-in
  user can insert directly. Tested with a second account.
- Settings, General has a "Share Usage Data" switch (on by default). Off means nothing is recorded, in the
  browser and again in the database.
- Raw events older than 200 days are deleted, nightly (pg_cron, `analytics_prune`), after the complete days are rolled up
  into per user per day rows (`analytics_user_day`, `analytics_user_first`) that are kept. `analytics_daily` is no longer written.
  `analytics_forget(user)` removes one person's events.

### Part 1: How Well The AI Works

Most of this is already in the database; the gap is that a correction does not record what the AI
had said at that moment, and nothing records which prompt produced it.

A rate on its own ("20% of drafts are edited") says nothing about what to change. Each AI number
below is therefore always split by things that explain it, and the page leads with the splits:

- Pairs, not rates: what the AI said and what the user changed it to (newsletter to personal, Junk
  to Not Junk). The most common pairs are the list of what to fix first.
- Content-free traits of the message, worked out in the worker or the browser: channel, sender type
  (person, company, marketing, WhatsApp group), whether it has an unsubscribe header or an
  attachment, length bucket, language, thread length, time of day. "Junk is wrong 40% of the time
  for receipts from companies with an unsubscribe header" is a prompt change; "Junk is wrong 8%" is not.
- What an edit did, not what it said, measured in the browser when a draft is sent: shorter or
  longer (and by how much), greeting changed, sign-off changed, a question added or removed,
  tone moved formal or casual, emoji added, paragraphs merged or split. "Most edits cut a third of
  the length" is a prompt change.
- Your own account is also a user. On the Analytics page, in your browser, your own corrections and
  edited drafts can be listed with their real text, decrypted with your own key like anywhere else
  in the app. Other users' text is never readable, only the traits above.
- Later, an optional "Send This Example" on a draft or label, shown to the user each time, that shares
  that one item on purpose. Not part of the always-on analytics.

Storing what the AI originally said does not break the privacy rule. It is a label from a fixed list
(priority, category, Junk), a prompt version and a duration, with no text in it. On the `feedback`
row it stays in the user's own encrypted-by-row data; in an analytics event it travels without any
message ID.

| Question | Measured by | Needs |
| --- | --- | --- |
| Is sorting right? | How often a priority, category or Junk label is corrected, by label, model and sender type (person, company, marketing, WhatsApp) | Done: carried on each correction event, with the prompt code on `message_ai` |
| Is Junk too strict or too loose? | Not Junk after Junk (false positive); Junk after a normal label (false negative); an unsubscribe soon after a message was kept | Same as above |
| Is Needs Reply right? | Of messages marked Needs Reply, the share replied to in 7 days; of the others, the share replied to anyway | Derivable from `messages` |
| Are drafts good? | `draft_outcomes.edit_ratio`: sent as is, lightly edited, heavily edited, discarded. Time from draft shown to sent | `draft_shown`, `draft_discarded`, `draft_regenerated` |
| Do one-tap choices help? | Choice offered, tapped (by kind: accept, decline, other time, answer), or ignored | `choice_shown`, `choice_tapped` |
| Is the AI learning? | Edit ratio over time for one user, and number of style rules | Derivable |
| Do summaries save reading? | Summary shown, then the original opened (a miss) or the conversation answered without opening it (a hit) | `summary_shown`, `original_opened` |
| Is the spoken brief used? | Plays started, finished, second where people stop, speed, skips | `brief_play`, `brief_stop` with position |
| Are voice transcripts good? | Transcript failures, and the original audio played after reading the transcript | `transcript_error`, `audio_played` |
| What does it cost and how fast is it? | `ai_usage`: cost per feature and per active user, cache hit share, median and slow latency, error and retry rate | Latency column on `ai_usage` |

### Part 2: What People Use

Screens log a route name only (`/inbox`, never `/inbox/<id>`).

- Reach: daily, weekly and monthly active users, sessions, time on each screen, return rate by
  week of sign-up.
- Features: opens of New, Search (and whether a result was picked, and its rank), Compose, Reply,
  Guided Choices, New Event, New WhatsApp Chat, Contact Edit, Merge and Split, Attachments (open,
  download), Summary, Calendar, Brief, and which Settings are changed.
- Dialogs: opened, submitted, cancelled or dismissed, time open, and the names (never values) of the
  fields touched and of validation errors shown. This shows which dialogs people abandon.
- Funnel: signed in, first account connected, first sync finished, first Summary seen, first draft
  sent. Time between each step, and where people stop. Connect attempts log provider, step and
  error code.
- Friction: error codes (not messages), time to first conversation list, sync lag from arrival to
  shown, empty states reached, and the same action repeated several times in a few seconds.
- Reliability: sync and send failures by provider, outbox retries, WhatsApp reconnects.

### What Records What

| Where | Events |
| --- | --- |
| Browser, tracker | `app_open`, `screen_view`, `screen_time` (only while the tab shows), `load_timing`, `error` (error type only), `rage_click` (three clicks on one thing in 1.5s) |
| Browser, dialogs | `dialog_open`, `dialog_close` (submit or cancel, seconds, field names touched) from the shared dialog component, by a name the code gives each dialog |
| Browser, features | `feature_used`, `setting_changed` (which, never the value), `search`, `thread_opened` (from Summary, list or search), `original_opened`, `attachment_used`, `empty_state` |
| Browser, labels | `label_corrected` (what you were shown against what you chose, with the message's traits and prompt code), `thread_action` (archive, delete, pin, read, Junk and so on, never which conversation), `reply_sent` |
| Browser, drafts | `draft_requested`, `draft_shown`, `draft_failed`, `draft_discarded`, `draft_sent` (with what the edit did), `choice_shown`, `choice_tapped` |
| Browser, media | `brief_play`, `brief_stop` (seconds and share reached), `audio_played` |
| AI worker | `triaged` (one per label shown: traits, labels, prompt code), `ai_call` (feature, model, prompt code, time, tokens, cost, tries, failure code). Traits and the prompt code are also kept on `message_ai` |
| Sync worker | `account_connect`, `first_sync_done`, `sync_error`, `send_result` (provider and whether it went), `wa_reconnect` |

The prompt code is a short hash of the exact instructions sent to the model, so results can be compared
across prompt changes without anyone writing a version number.

### Event Shape

`{ name, at, user, session, screen, app_version, size (phone, tablet, desktop), props }`, with `props`
limited to the list for that name. About 40 event names cover everything above.

### The Analytics Page

`/analytics`, three tabs (November 2026), the choice of tab, period and "Exclude Owner And Test Accounts" kept in the address:

- **Health** (the founder's screen, from `analytics_health`, not tied to the period): active people this week and this
  month, stickiness, activation funnel from signup (connected an account, first sync, first label seen, first draft shown,
  first draft sent, first reply sent, with the median time from signup), time to first draft sent by signup week, weekly
  retention from signup week (counting "used the app" or "sent a draft or reply"), the gone quiet list (active the week
  before last, nothing since, with accounts in error flagged), value delivered per active person, channel mix, signups per week.
- **Usage**: reach, screens, features, dialogs, search found something, errors, slow loads, reliability. Under Advanced:
  fields touched, repeated clicks, empty screens. Removed: devices, search detail, settings changed, send retries
  (sends are never retried), sync lag (nothing emits it), time to reply (rounded to whole hours, so it read 0).
- **AI**: the pairs and splits ("Where It Goes Wrong", Junk or Priority: Category and Needs Reply have no correction
  control, so they are not offered), drafts, replies, cost per person per month and the dearest five people. Under Advanced:
  edit details, tone and channel tables, pre-drafts, brief and voice, per prompt cost.

Numbers come from the database. Retention and activation use the signup date and all history, never only the events inside
the period. Totals come from the per user per day rollups; only the groupings by event property read raw events, capped at
200 groups per event name. Days and weeks are UTC. A session ends after 30 idle minutes (kept across reloads and tabs),
and there is one app open per session.

### Limits

- A reply's link to Needs Reply is approximate: it counts replies sent to conversations flagged Needs Reply,
  not Needs Reply conversations never answered.
- Tone moved, greeting and sign-off changes are worked out with simple rules, so they are good for trends,
  not exact.
- Message time of day uses the person's saved time zone; if there is none it is UTC.
- Sync lag (message arrival to shown) is not recorded, so it was removed from the page.
- `triaged` is one row per label shown, the biggest table; raw rows go after 200 days and the rollups keep the counts.
- Correction rates are approximate: corrections made in the period are set against labels made in the period. Bulk actions
  record up to 25 conversations each.
- A lone lowercase word cannot be told from a code word by shape, so the free-form values (dialog names, field names, empty
  screen titles) are allow-listed in `packages/analytics/src/allowed.ts` and read "other" when not listed. Add a name there when a dialog or empty screen is added. A dot is only allowed between digits.
- Events over the rate limit (50 a call, 120 a minute) are counted in `analytics_dropped` and shown on the Usage tab.
- Not built: waitlist conversion, comparison by app version, copy as CSV, a custom date range, billing money metrics (billing is deferred). The storage flags table still sits on the Usage tab and belongs under Admin.
- Your own text (corrected labels, edited drafts) is not shown on the page yet. See Order Of Work.

### Order Of Work

1. Done: table, `track()`, owner-only policy, opt-out and retention, prompt code and traits on `message_ai`.
2. Done: tracker, dialogs, features, labels, drafts, brief, both workers.
3. Done: the Analytics page with Health, Usage and AI (the funnel is the Health tab's activation table).
4. Next: a list on the Analytics page of your own corrections and edited drafts with their real text,
   decrypted in your browser with your own key, for working out what to change in the prompts.
5. Later: "Send This Example", shown to the user each time, if you ever want text from other users.

### Decided

- Our own table. No PostHog or other hosted tool.

### To Decide

- Whether other users should ever see their own numbers, or this stays owner-only.

## AI Assistant Connections (MCP)

Users can connect Messages to the AI assistant they already use, such as Claude, ChatGPT or Gemini,
and ask it things like "Who is waiting on a reply from me?", "Summarise my chat with Mrs Naidoo" or
"Am I free for a viewing on Thursday at 3?". Messages runs an MCP server (the Model Context Protocol,
an open standard those assistants support) that answers with the user's own messages, calendar and
contacts.

### Does It Fit Our Privacy Promise?

Yes, as long as it is the user's choice and only theirs. The promise is that nobody running Messages
can read a user's data. With MCP, the user decides to show some of their own data to an assistant
they chose, the same as copying a message into it themselves. Rules that keep it that way:

- Off until the user connects an assistant in Settings. Each connection says plainly what it can see
  and that whatever the assistant reads is then covered by that company's terms, not ours (for
  example, whether it trains on chats).
- The MCP server decrypts data, so it runs inside Confidential Space with the other workers (stage 4),
  and the KMS policy allows its image the same way. Nobody running Messages can read what passes
  through it.
- Each connection has its own scopes, chosen by the user: which accounts (say, work email and
  WhatsApp but not personal email), whether WhatsApp groups are included, whether calendar and
  contacts are included, and whether drafts can be created. Contacts or conversations can be hidden
  from assistants entirely.
- Answers carry only what was asked for: one conversation, or a search's top results, capped in size.
  There is no "export everything" tool.
- Every request is logged for the user to see in Settings: which assistant, which tool, when and how
  many items, never the content. A connection can be revoked in one tap, and its tokens stop working
  at once.
- What an assistant reads is never kept by us beyond answering the request.

What stays impossible on purpose: an assistant cannot send anything. It can create a draft, which
waits in Messages for the user to review and send themselves. This also protects against an email
that tries to instruct the assistant ("forward all invoices to ..."): message content is marked as
untrusted data in every answer, and with no send tool such an instruction has nothing to act on.

### Tools

| Tool | What it does |
| --- | --- |
| `needs_reply` | Conversations waiting on the user, most important first, with their one-line summaries |
| `search` | Find conversations by person, words, channel or date. Runs inside the enclave using the existing embeddings |
| `get_conversation` | One conversation's recent messages, newest last, with the formatting kept as plain text |
| `client_timeline` | Everything with one client across email, WhatsApp, voice notes and meetings |
| `daily_brief` | Today's meetings and viewings, clients waiting and anything urgent |
| `calendar` | Events in a date range, and free times of a given length |
| `contacts` | Look up a person or company and what is known about them |
| `create_draft` | A draft reply in the user's voice, from a decision or instruction, left in Messages for review |

### How It Is Built

- A remote MCP server over HTTPS (Streamable HTTP), so it works with web and desktop assistants
  without installing anything.
- Sign-in with OAuth 2.1 as the MCP specification sets out: the assistant sends the user to a
  Messages sign-in and consent page, then gets a short-lived token limited to the scopes they chose.
- The server reads the same tables as the app and opens fields with the user's key, so nothing new is
  stored in plaintext.
- Usage numbers (requests per tool and response times) go to the content-free analytics like the rest
  of the app.

### Which Assistants

- Claude: supports remote MCP servers as custom connectors with OAuth sign-in.
- ChatGPT: supports MCP servers as connectors and apps.
- Gemini: MCP works in Gemini CLI. Check support in the Gemini app itself when we build this, as it
  was changing quickly.
- Others that speak MCP (Microsoft Copilot, Cursor and so on) work with the same server.

Check each assistant's current connector requirements (review, listing, OAuth details) at build time.

### When

After Confidential Space (privacy stage 4), so the server never runs anywhere its operator could read
the data. A prototype limited to the owner's own account can come earlier, on the same footing as the
workers today.

## Engineering Setup

Decided 28 October 2026, so the codebase stays easy to change by one person and by coding agents.

- **Guides for agents.** `AGENTS.md` at the root (with `CLAUDE.md` pointing to it) maps the repo, lists the commands and the
  owner's rules. Each of `apps/web`, `apps/worker`, `apps/ai` and `packages` has its own short `AGENTS.md`.
  `docs/CONVENTIONS.md` is the one place for comment, file and naming rules.
- **Comments.** Every source file starts with a header comment saying what it is for; `scripts/check-headers.mjs` enforces
  it as part of `pnpm lint`. Comments explain why, not what.
- **Checks.** Biome lints web, worker and packages for correctness only; the formatter stays off because the code is
  hand-formatted and a rewrite would touch 400 files. `pnpm check` runs lint, typecheck, every TypeScript test suite and
  the Python tests. GitHub Actions runs the same on every push and pull request.
- **File size.** About 400 lines is the aim and 600 the limit. `lib/store.tsx` and the calendar page were split into
  `lib/app-store/` and `components/calendar/` on this basis. The provider in `lib/store.tsx` is still the largest file and
  the next candidate (its mail actions, tasks and contact merging can each become a hook).
- **Tests.** The web app's `lib` tests now run with `pnpm test` (they were not wired in before).

## Later

| Integration | Approach | Official |
| --- | --- | --- |
| Telegram | Telegram client API | Yes |
| Facebook Messenger | Messenger Platform for Pages, through the same Meta app review | Yes |
| SMS and RCS (Android) | Bridge through Google Messages for Web pairing | No |
| iMessage | Needs a Mac running as a relay, such as BlueBubbles | No |
| Slack | Slack API. Low demand in South Africa | Yes |
| Compliance export | Per-client archive of WhatsApp and email for FAIS, legal and POPIA records | n/a |
| Agency accounts | Moved into the plan: see Teams | n/a |
| AI assistants (MCP) | Remote MCP server for Claude, ChatGPT, Gemini and others, after privacy stage 4. See AI Assistant Connections | Yes (open standard) |
| Admin systems | Property CRMs (Propdata, Entegral), legal practice tools (LEGALSUITE, GhostPractice, AJS), Astute for advisers. Build when paying customers ask | Varies |

The long-term goal: every messaging app a professional uses, in one place.

## Security and Cost Review (27 October 2026)

Proposed, not yet approved. Each finding was read in the code. Fixes are listed in the order to do them.
Time is Claude-built, before review and testing.

### What Is Solid

- Row level security is on for every table (an automatic trigger) and the access policies are scoped to the signed-in user.
  Tables that hold keys and credentials (`user_keys`, `team_keys`, `account_credentials`, `message_embeddings`) have
  no policies at all, so the app role cannot read them.
- Every function meant for the workers is revoked from signed-in users. Functions callable by users check roles inside.
- Storage buckets are private and scoped by user folder.
- Every API route checks the Supabase token, the origin and a rate limit. OAuth uses encrypted cookies and PKCE, and the
  return address is an allowlist.
- Email HTML is shown in a sandboxed frame with no scripts. There is no `dangerouslySetInnerHTML` in the web app.
- No secrets in git or its history. No path lets an incoming email send, forward or delete anything: the AI only writes
  drafts, labels and summaries.

### Build Status (27 October 2026)

Code written, tested and not yet applied. Tests at the end: crypto 32, worker 619, AI worker 487 all pass, and the web and worker
typechecks are clean. No migration has been applied, no backfill has been run, no Google Cloud resource exists, and nothing
was run against real mail or the live database.

Built:
- SQL (`20261102100000` to `20261102100500`): no insert or delete on `accounts` for signed-in users, setup allowance once per
  person per address (`ai_setup_grants`), ownership checks and narrowed write grants, bucket size and type limits, push endpoint check,
  owner needs a confirmed email.
- Network and web: the shared public-address check now covers hex-mapped, NAT64, 6to4 and Teredo addresses and is used by
  unsubscribe, the LinkedIn proxy and site icons (unsubscribe pins the resolved IP). Enforced nonce CSP (`middleware.ts`,
  `lib/csp.ts`). Rate limits count in Postgres (`rate_limit_hit`) and fail closed on keys and connect routes.
- Encryption: flags default on and production refuses to start with them off. Sealed on write and opened on read: attachment
  filenames, calendar titles and locations, card names, writing examples, style rules, contact fields, Instagram files, Zoom
  recordings, attachment bytes (`keepFile`). Backfill scripts exist.
- Keys: `kms:v1` (TS and Python), `v2:` per-user connector credentials, team key versions with a re-encrypt job on member removal,
  rewrap and reseal scripts.
- Embeddings: sealed (`embedding_data`), nearest-reply search in the AI worker, plaintext column dropped by a second migration.
- Storage: hash dedupe, videos over 25 MB kept as a link, 20 GB per seat cap with 10% grace, Not Kept Here badge, 80% and 100% notices in Settings.
- Shared team chats: attachment names and file copies re-sealed under the team key and rotated with it.
- AI cost: allowance checks fail closed and reserve in-flight spend, meetings send each recording once through a cache and are held
  against the share first, hedged drafts off, learning, brief and chasers on the fast model, daily logo cap and tries, voice notes capped
  by length, idle backoff in the AI worker, signals and chasers read only changed rows.
- Sync: account heartbeat at most every 15 minutes, adaptive Gmail and queue polling, bounded missing-file retries, `ai_usage` rollup.

Not built, or only partly:
- Confidential Space (stage 4): deliberately left until the first paying client.
- Gemini Batch API: the client is in `gemini.py` and tested but not wired into triage or learning (needs a job table).
- Cheaper transcription model: setting exists, default unchanged, because nothing shows the speaker-turn format survives.
- Presence ping from the web app, so Gmail polling stays at 5 seconds while someone reads. Today only mail and queued work count as activity.
- The 80% storage email, the 3-address-farming cap (many different addresses still each earn a setup allowance), and a team copy is not counted in the storage meter.
- Deleting a single attachment or thread does not remove the team copy of a shared file (orphans possible). Deleting or removing an account does.
- Zoom recording backfill, merging old duplicate files, `create_contact` and address book company values (still plain), short-lived calendar queue rows.
- Names of contacts and companies are still the earlier stage 2 encryption only.
- Dashboard work: Confirm Email on, no OAuth provider with unverified email, check the owner row in `analytics_config`.
- The audio price in `pricing.py` (`AUDIO_INPUT_USD_PER_M`, 3.00) is a guess. At a $5 month a one-hour meeting is held at about $0.43 against a $0.75 transcribe share, so check it.
- Not tested in a browser: `/summary` and `/inbox` with the new CSP (only `/login` was loaded), team file opening, sealed file previews.
- Draft and triage quality on the cheaper models and the local similarity search needs your real mail before the plaintext vector column is dropped.

Order to apply:
1. Google Cloud: project `messages-keys`, key ring `messages` in `africa-south1`, key `user-data-keys`, a service account with
   the encrypter and decrypter role. Set `KMS_KEY_NAME` in web, worker and AI, and `GOOGLE_APPLICATION_CREDENTIALS_JSON` where there is no metadata server.
2. Apply the migrations in order from `20261102100000` to `20261103000000`, except `20261102800100` (it drops the plaintext vectors).
3. Deploy the web app, sync worker and AI worker.
4. Dry run then `--apply`, in this order: `pnpm rewrap-keys`, `pnpm credentials:reseal`, `encrypt-fields`, `encrypt-attachments`, `python3 -m ai.seal_embeddings`.
5. Check drafts on your real mail, then apply `20261102800100`.
6. Delete `KEY_WRAPPING_KEY` once the rewrap reports nothing left. Keep `ENCRYPTION_KEY` for short-lived handoffs.
7. Give Konva its own Gemini key.

### Security Fixes, In Order

1. **Make encryption on by default and complete** (1 to 2 days). Flags default on and the services refuse to start in
   production with them off. Encrypt the fields listed in the Code Check: writing examples, style rules, contact notes,
   attachment names, calendar titles and locations, meeting participants. Encrypt attachment, Instagram and Zoom files
   before upload, as notes and brief audio already are.
2. **Close the AI budget hole** (hours). Remove INSERT and DELETE on `accounts` for signed-in users and give the setup
   allowance once per person per address. Also check the same for `profiles`, `threads`, `messages` and `attachments`, whose policy
   checks only the person's ID and not that the account or thread they point at is theirs.
3. **Fix the unsubscribe address check** (hours). `isPrivateAddress` in `send/unsubscribe.ts` misses addresses like
   `::ffff:7f00:1`, and it looks the host up and then fetches it, so DNS can change in between. A sender could make the worker
   POST to its own network or the cloud metadata address. Use the safe check already in `photos/site-icon.ts` and pin the address.
4. **Same check for the LinkedIn proxy** (hours). The host is checked by name only, so `127.0.0.1.nip.io` passes.
5. **Enforce the content security policy** (1 day). It is report-only and allows inline scripts. The session is in local
   storage and `/api/keys` hands the data key to anyone holding the token, so one script injection would give up the account. Use nonces and enforce it.
6. **Wrapping key into Cloud KMS (stage 3)** (2 to 3 days). Nothing exists in code today. Also wrap the connector
   sign-in key in KMS, and move connector credentials to a key per user. Rotate the team key and re-encrypt when a member leaves.
7. **Embeddings** (decision needed). Plaintext vectors defeat the aim. Either run the similarity search inside the
   protected worker, or drop vectors and search the encrypted browser cache.
8. **Confidential Space (stage 4)**. Build at the first paying client (running cost in that section).
9. **Real rate limiting** (half a day). The limiter is in memory per server instance, which on Vercel means it barely limits.
   Use a small table in Supabase or a hosted counter. The mail server connect limit matters most.
10. **Smaller items**: file size and type limits on storage buckets; push subscription addresses are unvalidated
    (add a check before any sender is built); the owner is identified by a fixed email address in
    the database, which is safe only while Supabase Confirm Email is on and no sign-in provider lets someone claim that address
    unverified (check in the dashboard); links in the email frame may open without the sandbox; check the Python and npm
    dependencies against a vulnerability database; give Konva its own Gemini key (it shares Mendr's); turn on database backups with point in time recovery and two-factor sign-in on Google, Vercel and Supabase.

### Cost Drivers, From The Code

Estimates per normal user a month at current prices (before the January price rise):

| Driver | Estimate | What to change |
| --- | --- | --- |
| Meeting transcripts (full model) | $1.50 to $4 per 10 hours | Each window re-sends the whole recording, so 5 hours bills the audio 5 times. Send once, or cache the file, use the cheaper model, and cap minutes before the call |
| Drafts (full model, hedge, auto) | $1.20 to $3.60 | Cheaper model for automatic and pre-drafts, set a maximum output, drop the hedged second request (about 10% of drafts bill twice), limit compose drafts |
| Triage (cheaper model) | $0.90 to $2.50 | Already efficient. Skip more bulk senders by header, no model needed |
| Learning: voice, edits, signals, notes | $0.50 to $2 | Move voice, edit and signal learning to the cheaper model, set a maximum output |
| Spoken brief | $0.50 to $1.20 | Keep Listen-only, cheaper speech model, cap parts |
| Brief script, chasers | $0.20 to $0.40 | Cheaper model |
| Voice notes | under $0.20 | Cap by minutes, not bytes |
| Company logos and search | one-off $50 to $100 | Daily cap, maximum tries |
| Embeddings | under $0.01 | Nothing |

Other levers:
- Nothing uses context caching or the Batch API. Prompts are under the roughly 1,000 token minimum, so the automatic discount
  barely applies. The Batch API (about half price) fits the first import, nightly learning and company summaries,
  none of which anyone waits for. That roughly halves the $1.20 first import.
- Prices double for Gemini 3.8 Flash and the speech models on 1 January 2027. Move triage-like work to the cheaper model and test quality on real mail first.
- Gmail is polled every 5 seconds per account (`history.list`, cheap) and each account's row is updated every 60 seconds, which is a
  database write and a realtime event per account per minute. Use Gmail push, and update the row only when something changed.
- The AI worker makes about 90 requests a minute when idle, whatever the number of users. Poll less often when idle.
- Hourly jobs read 1,000 drafts with bodies across all users; narrow them to changed rows.
- The free Supabase plan breaks at about 10 heavy mailboxes (500 MB database), and 20 GB per seat needs Pro.
- Fix first for cost: the setup allowance hole, the fail-open and stale allowance checks, the per-window meeting resend, then the cheaper model moves.

### Order Of Work

1. Items 2, 3 and 4 above (a day together).
2. Encryption on by default and the missing fields (item 1), and the allowance checks (fail closed, include in-flight spend).
3. Meeting resend, hedge and cheaper model moves (about 2 days), measured on the owner's real mail.
4. KMS and team key rotation (item 6), the CSP (item 5), the embeddings decision (item 7).
5. Batch API for imports, Gmail push, real rate limiting.
6. Confidential Space at the first paying client.

## Code Review, Bug Fixes and Cost Pass (28 October 2026)

Six read-only reviewers went through the web app, the web routes, the worker, the AI service, the Go helper and the database
policies, and four more looked at cost. Every finding came from reading the code. The ones marked confirmed were also
reproduced. High and medium findings were then fixed in code and checked with the unit tests. Nothing was run against real
LinkedIn, Instagram or provider accounts, and nobody has looked at the changes in a browser yet.

### Fixed

- Email parser: an unclosed HTML tag blocked the single-threaded worker for minutes (confirmed, 60 KB took 2.1 s and grew with
  the square of the size), and 5,000 nested tags threw a stack overflow so the email could never be stored (confirmed). Both
  are fixed in `packages/email-text`, with the input capped and the work wrapped so it cannot throw. 1.6 MB of hostile input now
  takes under 1 ms.
- Follow-up checks never ran because `CHASER_MAX_OUTPUT` was never defined (confirmed). They now run, on the full model, and
  filter by age in the query.
- Calendar Search Events did nothing unless a delete was in flight (confirmed). New LinkedIn conversations could not send
  because the helper never kept its session after login (confirmed). Both are fixed and tested.
- Sending and the worker: a send could stay in "sending" forever after a database error, mail actions could run twice (they are
  now claimed with a `working` state), sync loops could die silently (they now restart with backoff), IMAP read flags ignored
  UIDVALIDITY, and one failing row aborted a batch.
- AI and budget: an unpriced model was billed at $0 (now the dearest known price), a zero or missing budget share meant
  unlimited, the worker wrote plaintext when a key could not be unwrapped (it now raises), voice notes failed for good when the
  budget was only paused, draft audio paths accepted `..`, and untrusted email text is now fenced in the prompts. The earlier
  `logos` exclusion from the allowance, dropped by mistake in the workspaces rewrite, is restored.
- Web: unread state re-arms after a new message, a message arriving mid-load is no longer dropped, no duplicate "Sending" bubble,
  a failed send no longer reappears, a failed key call no longer leaves Send disabled, the right person shows after a merge,
  Cmd+K finds text in angle brackets, non-Latin names merge correctly, large contacts load, a failed note save no longer
  deletes files, and a slow event create no longer invites a duplicate.
- Web routes: per-IP limits on the credential-probing routes, validated bodies (400, not 500), a separate rate-limit counter per
  route, compare-and-swap on the code routes, and duplicate-account handling.
- Network: the logo and autoconfig fetchers connect only to the address they vetted. Invites need a confirmed email.

### Cost Pass

The live database is 176 MB with 148 MB of attachments, and a medium user costs about $4 a month in Gemini, so none of this
is urgent today. It matters as the number of users grows. The largest fixed cost was idle polling, about 5 million database
requests a month before any user does anything.

| Change | Effect |
| --- | --- |
| Queue poll every 60 s (5 min idle) plus one poll after each Realtime reconnect | 32 to 8 queries a minute while active |
| Gmail, Outlook and Teams polling per account, backing off when quiet | Gmail and Outlook calls down by about 80 to 90% on quiet mailboxes |
| Address indexer once at start then hourly (partial indexes) | 16 queries a minute to about 0.1 |
| Contact linker, logos, share, rotation and meeting jobs gated by what changed | A few queries per 15 minutes instead of per user |
| IMAP skips the whole-inbox read when nothing changed; batches flush by size | A quiet inbox costs 0 instead of about 20 requests; memory bounded |
| WhatsApp in-memory maps bounded | No unbounded growth |
| iCloud Reminders, brief, triage and supervisor loops back off when idle | About 20 queries a minute per account down to about 2 |
| Embedding cache lasts 45 minutes and clears only on a new embedding | Far fewer 9 MB reloads |
| Sealed 256 px thumbnails for photo tiles, memory-only cache | About 130 to 300 times less data per tile |
| Cold start loads participants as ids and folds in small queries; delta resync after a Realtime drop | Several MB less per load; a short drop costs a few KB |
| Shared chats poll once a minute, only while visible | About 6 full reloads a minute down to about 1 small request |
| Router cache, middleware skips soft navigation and media, cache headers, lazy search and tour, lazy phone library, font preload off | About 70 to 115 KB gzipped less first-load JavaScript (estimate) and fewer function runs |
| Chasers batched, thinking minimal for transcription and the brief script, slower learning triggers, shorter draft and bulk prompts, retry caps, a daily logo spend cap | About 10 to 15% of the medium user's Gemini spend (estimate) |
| Pre-drafts only for mail that needs a reply, capped at 15 a day | Protects the budget meant for drafts people ask for |
| Daily retention job for finished queue rows and old drafts; analytics raw events kept 200 days | Stops tables growing without limit |
| Multi-worker support: accounts split by a hash of the account id, shared jobs on shard 0, a lease per shard | A second sync worker can run without doing every account twice |

### Running More Than One Worker

The sync worker can now be split across machines. Set `WORKER_SHARD_COUNT` and `WORKER_SHARD_INDEX` (defaults 1 and 0, which
behaves as before). Each shard runs the connectors for the accounts whose id hashes to it, and leaves work for other shards'
accounts alone. Shard 0 also runs the jobs that read or change data across users: photos, company logos, the contact,
address and meeting linkers, usage rollup, share jobs, key rotation and team rules. A lease (`worker_leases`) stops two
workers running the same shard, and startup recovery of in-flight rows is limited to a shard's own accounts. Changing the
shard count reassigns most accounts, so restart the workers close together. Deploying before the lease migration is safe: the
worker warns and runs without a lease.

The AI worker is separate and is not safe to run as several instances yet. Only the brief claims its rows. Drafts, triage and
transcription would do the same work twice. The cheapest fix is one instance per job group behind the same lease, or a user-id
filter per instance. Do this before adding a second AI worker.

### Decided (28 October 2026)

- Old bulk mail: full text is kept for 30 days, then cut to a preview of about 500 characters. A worker job does it, because the
  text is encrypted. Messages in threads you replied to, from people you wrote to, with a draft or pinned, are never shortened.
  View Original still fetches the whole email from the provider. The messages table averaged about 33 KB a message, which is
  the largest database growth driver.
- Email attachments over 5 MB or older than 30 days are fetched from the mailbox the first time they are opened. WhatsApp and
  other chat media stay copied at once, because WhatsApp media expires on its servers. Files already stored are not touched.
- The server keeps asking Supabase Auth to check each login token. Checking locally would save a round trip but a revoked
  session would work for up to an hour.
- No Batch API: the owner does not want results to arrive up to a day late. No static pages, because the per-request nonce
  protects the decrypted data and keys that live in page memory.
- Triage stays on `gemini-3.5-flash-lite`. There is no "Gemini 3 Flash Lite". `gemini-3.1-flash-lite` ($0.25 in, $1.50 out)
  would cut triage cost by about 30%, roughly 5% of total spend, but Google lists its earliest shutdown as 7 May 2027.
  `gemini-2.5-flash-lite` is cheaper but Google now limits it to accounts that already used the 2.5 models. The model is set by
  `TRIAGE_MODEL` (default unchanged) and `gemini-3.1-flash-lite` has a price entry, so a comparison on a sample of real mail
  can be run before deciding.

### Not Done

- Binding each encrypted value to its row, retiring old team keys safely, and re-keying the contact card hash: each needs a data
  migration and a design decision.
- Soft deletes. Realtime cannot filter deletions by user, so every delete is sent to every connected client. A `deleted_at`
  update that carries the user filter would fix it.
- Opus or AAC for the spoken brief (about 12 times smaller than the uncompressed audio), and a raw-bytes brief format.
- The domain-level skip in triage and the logo search filter need columns that do not exist yet (`users_seen`, `personal_seen`).
- Restoring the idle-time cache for per-job model tests, and a comparison script for `gemini-3.1-flash-lite`.
- One LinkedIn account per user was not added, because it would stop someone connecting two profiles.
- Packing messages so sealed text is stored as bytes, not base64 (it grows by 37%).

### Migrations (28 October 2026)

Applied to the live database and checked in the database itself: invite confirmed email, strict draft audio path, pending draft
cap, zero budget share (with `logos` restored), unique account address index, poller indexes, the `working` mail action status,
and then the cost pass: address indexer indexes, the pre-draft gate (needs a reply, 15 a day), the retention job (scheduled daily
at 03:41), the analytics prune at 200 days, the email original Realtime column list (no `html`), thumbnail path, mail action
claim time, the follow-up indexes, `worker_leases`, `messages.body_shrunk_at` and `attachment_fetch_requests`. The lease was
tested in the database: a second holder is refused, the holder renews, a wrong holder cannot release, and an expired lease can be
taken over.

The three team migrations were applied after that: `team_owner_features`, `team_after_launch` and `team_review_fixes`. They add
shared inboxes and their access lists, assignee replies, the Compliance open log, cover periods, the company voice, client
list management, response tracking, the compliance exports, and the stricter shared-chat read policies (`can_read_thread_at`,
`agent_has_left`). All 87 tables, functions, policies and triggers they define were checked in the live database, row security is
on for every new table, and the shared thread, message, attachment and message AI policies now use the new functions. The
database advisor then showed three trigger functions callable over the API, so `revoke_team_trigger_functions` was added and
applied; `invite_preview` is now the only function callable without signing in, and that is intended (invite links).

Applied last, on 28 October: `drop_plaintext_embeddings`. First the sealed embeddings job
(`python3 -m ai.seal_embeddings --apply`) sealed all 2,486 vectors in the live database, and every one was decrypted and compared
with its plaintext copy: none failed to open and the largest difference was 1.5e-8 (float precision). Then the migration removed
the readable `embedding` column, its two indexes and `similar_replies`, and `embedded_message_count()` now counts sealed vectors.
The database was checked afterwards: 2,491 rows, 2,486 sealed (the other five are embeddings not made yet). The seal script
can no longer run against the database, so its docstring says it is finished; its tests stay.

`packages/db/src/database.types.ts` is kept by hand and is not regenerated from the database. The generator marks every RPC
argument and result as nullable, which breaks typechecking in 14 places in the web app and the worker, so new columns and
tables are merged into the file instead. The advisor also reports leaked password protection as off in Supabase Auth, which is
a dashboard setting to turn on.

### Found While Starting The AI Worker (28 October 2026)

The AI worker could not start on this code: a comment placed inside the `jobs` list in `ai/__main__.py` swallowed the end of the
follow-up checks line, so Python could not parse the file. The 589 tests never import that file, so they passed. It is fixed, and
`tests/test_entrypoint.py` now compiles and imports the entry point. Once it ran, every Gemini call failed with HTTP 402:
Google reports `RESOURCE_EXHAUSTED: Your prepayment credits are depleted`, so the AI Studio prepaid balance has to be topped up
(the key is the one shared with Mendr, so the balance is shared too). The worker was stopped, because a voice note can be marked
failed for good after a few such errors. In the minute it ran it wrote 17 triage results for senders already settled from history (no model call); it wrote no brief, no embedding or learning result, marked no voice note or draft as failed, and recorded no Gemini spend.

## Approvals and Risks

These take calendar time no matter how fast the code is written, so start them early:

- Google verification and the yearly CASA security assessment for Gmail access. Until then, 100 test
  users at most. Decided 26 October 2026: verification is finished before launch, so launch is not
  held to 100 users.
- Microsoft publisher verification. Many firms also need their IT admin to approve the app, and
  Teams chat access makes that more likely.
- Zoom Marketplace review before other Zoom accounts can connect (Zoom is hidden until then).
- Meta Business Verification and App Review (Advanced Access for instagram_business_basic and
  instagram_business_manage_messages) before other Instagram Business accounts can connect. Needs
  the registered business documents, a privacy policy and a screencast per permission. About 2 to 6
  weeks, so start it now.
- Instagram personal accounts through instagrapi break Meta's terms like Baileys does, and Instagram
  is stricter: sign-ins from servers get security checks, and accounts can be locked or banned. Tell
  customers plainly.
- Google Chat and Meet transcripts need Google Workspace, and the Chat API needs a Chat app set up in
  the Google Cloud project.
- WhatsApp through Baileys breaks Meta's terms and numbers can be banned, business numbers included.
  The user accepts this risk. Tell customers plainly.
- LinkedIn through mautrix-linkedin carries the same kind of risk, and its password sign-in is new
  (October 2026), so it may break when LinkedIn changes its sign-in pages. LinkedIn restricts accounts quickly
  when a session is used from somewhere new or acts like a bot, sometimes until ID is verified.
- iCloud Reminders through iCloud.com's private endpoints is unofficial: Apple can change them at any
  time, and repeated sign-ins can trigger an Apple account lock.

## App Shell, Navigation and Changelog (28 October 2026)

Decisions made while building the screens, so later work follows them:

- **One header pattern.** Every list or page screen is built from `components/pane.tsx`, copied from the Inbox: a title row
  (h-8, at most one action on the right), one row of controls (views as text buttons, a small select), then the search in its
  own band. Buttons, selects and inputs are h-8. No outline buttons (date pickers are the one exception); the main action is
  secondary, quiet actions are ghost. Dialogs show the stock X top right and have no Cancel (3 November 2026, replacing "no X, Cancel is ghost"); AlertDialog confirms keep Cancel; the main action is secondary.
- **Mobile bottom bar.** Summary, Calendar, Inbox, Contacts and More. More is its own screen (`/more`): New Email, WhatsApp,
  LinkedIn and Instagram messages, New Event and New Task, then Notes and Attachments, then Analytics, Updates and Admin for the
  owner, then Settings.
- **Usage ring (2 November 2026).** The last item in the desktop rail, below Settings, is a ring showing the limit closest to
  running out (AI this week, AI this month, or storage), since that is the one that pauses something first. Hovering shows
  every limit with its reset date and each AI feature's share (or Paused Until); a click opens Settings, Usage
  (`components/usage-ring.tsx`, sums in `lib/usage.ts`). Not on the mobile bottom bar.
- **Connected Accounts shows one row per sign-in.** Google (Gmail, Calendar, Tasks), Microsoft (Outlook, Calendar, To Do,
  Teams) and iCloud (Mail, Calendar, Reminders) are each one row. The workers still keep one account row per part. A name can be
  given to a sign-in; it shows beside the logo only once there are two of a service.
- **Tasks can be created, edited and deleted from the Calendar** for Google Tasks, Microsoft To Do and iCloud Reminders, through
  the same `task_updates` queue as a tick (the title and notes are sealed in the browser). Every task needs a due date, because
  the Calendar draws tasks on their day.
- **Notes export to PDF** in the browser (`lib/pdf-writer.ts`, `lib/note-pdf.ts`): styled text, lists, check boxes, tables, code
  and pictures. The file downloads and is saved in the note.
- **Profile Photo.** A photo in Settings, General is used for "You" (`profiles.avatar_path`, stored at `<user id>/me`).
- **Seen on Instagram and LinkedIn.** Their conversations show "Seen" under your last seen message; WhatsApp keeps its ticks.
- **Archive view (28 October 2026).** The inbox views are All, Priority, Junk, Subscriptions and Archive. Archive lists archived
  conversations (junk or not), the row action becomes Unarchive there, and Undo works both ways. A Deleted view came in Wave 4 (see below); it was agreed but
  not built: trashed threads are not loaded, so it needs an on-demand load, Restore, Delete Forever and a 30 day auto-empty
  (a `trashed_at` column and the retention job).
- **Needs Reply sees the conversation (28 October 2026).** Triage judged only the newest incoming message with a one line
  definition, so "turns out there are student tickets" in a plan you had agreed missed Needs Reply. The model now also gets
  the last 4 earlier messages of the conversation (both directions, 300 characters each, none for bulk mail), and
  `needs_reply` covers questions, requests, proposals, plans not yet settled and statements that move plans forward, leaning
  true for people you know. Messages already triaged keep their old answer until they are triaged again.
- **Updates page.** `public.updates` is the changelog, edited in the Updates tab in Admin. Every push writes its own entry,
  published, before it goes (decided 3 November 2026); a pushed version with no entry gets one written from its diff.
  Published entries are public on the marketing site at `/updates`.
- **What's New (Wave 7).** Any signed-in user reads published updates only (one select policy; `published_at` is set by a
  trigger when an entry is published). A What's New dialog opens once after sign-in, after setup, when the newest published
  entry went public after the one the user last saw (`whatsNewSeen` in the sign-in metadata; a new sign-up is compared with
  the day they joined). It lists the changes under New, Improved, Fixed with See All Updates, a read-only `/whats-new` page.
  It is also in Settings and the mobile More screen. Owner helper: `pnpm updates:draft` prints a JSON skeleton from `git log`
  since the last `vX.Y.Z` commit; it calls no AI and writes nothing.

## Private Test Checklist (28 October 2026)

Where the product stands: the core screens and every connector are built, but most of it has only been run by the owner, on
the owner's Mac. A test with 5 to 10 trusted people is about 2 to 3 weeks of Claude build time away. A wider test with South African
professionals is a few months away, because of the approvals above.

Before the private test:

1. **Save the work.** Commit often (a version per release) and write and publish each release's entry on the Updates page.
2. **Walk every screen once, signed in, at phone and desktop width,** on real accounts. Most work so far was checked only with
   fakes or at phone width.
3. **Host it.** The web app and the workers (sync, AI, Instagram, iCloud Reminders) need an always-on machine with logs and an
   alert when one stops. Today they run in terminals on one Mac and stop when it sleeps.
4. **Sign-in limits.** Gmail is a restricted Google scope: until the security review is done, testers must be added as test users
   (up to 100) and will see the "unverified app" warning. Microsoft and Meta have similar rules.
5. **Say plainly which connections are risky.** WhatsApp, LinkedIn, Instagram (personal) and iCloud Reminders use unofficial
   routes. Label them experimental, explain the account risk, and give each a switch to turn it off.
6. **First-run walkthrough** that shows the value (drafts, AI profile, merges) and handles a failed or slow connection.
7. **Privacy page** in plain words: what is stored, what is sealed, what the AI sees.
8. **Backups and a way to delete an account** and all its data.
9. **Finish the Python LinkedIn helper** (added 29 October 2026; detail in the LinkedIn paragraphs under the connectors).
   Until these are done the worker keeps the Go helper and LinkedIn stays off for testers:
   - Capture a send into an existing conversation (a chat the owner controls) and a live incoming message while
     `linkedin.com/messaging` is open (`captures/linkedin/03-live.har`), then fix the UNVERIFIED parts: the send body key
     in `api.py` and the real-time message events in `mapping.py`.
   - Capture a document upload and a video upload.
   - Capture the code and app-approval steps of the sign-in, then build the password sign-in (`factory.password_login`
     still answers `unsupported`). If a server cannot make that request past LinkedIn's bot checks, decide between a
     cookie-based connect in the web page and keeping the Go helper.
   - Run one live read test with a real session, read only (no sends, no opening chats).
   - Refresh `queries.py` from a new capture whenever LinkedIn ships a web build and calls start answering 400 or 404.
   - Switch the worker's command to `python3 -m ai linkedin`, then delete `apps/linkedin`, its CI step and the
     `linkedin:build` script, in one change.

Core for the test: email, WhatsApp, calendar and tasks. Instagram and LinkedIn are labelled experimental.

## Speed and Efficiency Pass (29 October 2026)

Found by reading the code, not by measuring. The Gemini account was in arrears, so nothing here was tried live; the
numbers below are estimates from the loop intervals.

### Decided and Built

- **Gemini billing breaker** (`apps/ai/ai/billing.py`). A billing refusal (402, 403, PERMISSION_DENIED, or a 429 or
  400 with clear billing wording) pauses every Gemini call for 10 minutes, then lets one probe through. Ordinary
  per-minute rate limits keep their retries and do not trip it. While paused, a call fails at once with
  `billing_paused` and sends nothing. Transcribe and meetings do not count it as a try, triage does not re-ask a
  failed batch one message at a time, and drafts, briefs and bulk reads stay queued instead of failing. An automatic
  daily brief is recreated after the pause.
- **Idle polling in the AI worker.** Drafts idle ceiling 5s to 10s (not 15s: nothing wakes the loop, so a longer wait
  would delay a requested draft), stale-pending sweep 30s to 60s, audio cleanup every 300s on its own timer, brief
  idle 30s. Active cadences are unchanged. Bulk read idle moves to 30s too, with the bulk read work itself.
- **Sync worker queue safety poll** 60s/5min to 2min/10min. Realtime already pushes every queue and a read runs on
  each subscribe, so the poll is a backstop. Named columns instead of `select("*")` in the queue loaders were tried
  and dropped: the row types are passed whole to the connectors and used for patches, so narrowing touched many files
  for no payload saving.
- **Indexes** (`20261115090000_idle_query_indexes.sql`): contact_identities, contacts and address_book_cards on
  (user_id, id), a drafts audio-cleanup partial index, drafts pending in claim order (replacing `drafts_pending_idx`),
  and sent-from-draft outbox rows for learning. Not applied yet.
- **Web:** compose dialog loaded with `next/dynamic`, and the phone-format load started in parallel.
- **Learning** counted a row as done when Gemini failed; it now counts only real work.

### Not Done

- Written but held back, because they sit in files with other work in progress (`store.tsx`, `__main__.py`,
  `bulk_read.py`): the flattened `messages` array computed only when read, `listThreads` cached per view and filter
  (`memo-last.ts`), the bulk read idle interval, and `tests/test_idle_polling.py`. They go in with that work.
- Split the store context into state and actions (about 80 to 120 files use `useApp()`; 1 to 1.5 days). The biggest
  remaining web win, since any store change redraws every screen.
- Realtime wakeups for drafts and bulk reads in the AI worker (needs a websocket client and the tables in the
  Realtime publication). Revisit once the cheaper intervals are measured.
- Check `pg_stat_user_indexes` and drop the likely duplicates: `messages_sender_idx` against
  `messages_sender_address_idx`, and `feedback_thread_idx` against `feedback_thread_recent_idx`.
- The attachment-requests Realtime channel has no read on resubscribe; if its publication migration is missing, an old
  attachment can now wait up to 10 minutes.
- A 5.6MB `simple-icons` chunk shows in the dev build with no import found; rebuild clean and look again.
- Measure real per-job latency, cost and cache hit rate from the usage rows once Gemini is paid for.

## Timeline

Claude writes most of the code, so building the MVP list is about a month. What takes longer is
testing on real accounts, refining from feedback and waiting on the approvals above. Build time is
about 2 hours each weekday morning, 2 hours each evening and full days on weekends.

## Push Based Mail Sync (2 November 2026)

Mail is no longer polled every few seconds. Built, not yet switched on: it needs the owner actions below.

- **Gmail.** `users.watch` publishes to a Cloud Pub/Sub topic; the worker reads a PULL subscription (outbound only, so
  no public endpoint and fine inside Confidential Space) and wakes the connector for that mailbox, which reads
  `history.list` from its own stored `historyId`. A notification is only a hint: one no later than the stored cursor
  is ignored. The watch is renewed daily. Several shards can share a subscription: a message for a mailbox another
  shard owns is released back at once. Env: `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_SUBSCRIPTION`.
- **Outlook.** Graph change notifications post to `apps/web/app/api/graph/notify`, which answers the validation
  handshake and checks a signed `clientState` (account id plus HMAC under `GRAPH_NOTIFY_SECRET`), then upserts one row
  per account into `mail_hints` (no content). The worker hears it through Realtime, debounces a burst (first hint at
  once, the rest as one trailing sync), and syncs every folder. The worker creates the subscription and renews it when
  under 48 hours remain (mail subscriptions last under 3 days). Env: `GRAPH_NOTIFICATION_URL`, `GRAPH_NOTIFY_SECRET`.
- **IMAP.** Each account already holds one IDLE connection. Its housekeeping tick moves from 1 minute to 5
  (`IMAP_POLL_MS`) when the server has IDLE, and stays at 1 minute without it. Slower jobs keep their wall-clock spacing.
- **Fallback.** Without push configured, Gmail and Outlook are checked every 5 minutes (`MAIL_SLOW_POLL_MS`). With push
  configured but failing for an account (watch or subscription refused), that account keeps the old activity based
  cadence, so a broken setup never makes mail slower than before. Every interval is an env setting.
- **Heartbeats.** The 15 minute per account heartbeat now writes `account_heartbeats`, which is not published to
  Realtime, instead of `accounts.last_synced_at`. A status change still writes `last_synced_at`. The web app should
  read `account_heartbeats` on demand for the Last Synced line.

## Reply Box AI Controls (29 October 2026)

### Decided and Built
- Tooltips on the AI buttons are one short line. The attach and voice note buttons have no tooltip (they keep their screen reader labels).
- Redraft is now **New Draft**: it writes an entirely new draft and replaces the current one (Undo brings it back). The dialog says so.
- New one-click **Fix Typos and Grammar** button, shown when the box has text. It runs the existing edit with no instruction, which only fixes spelling, grammar, punctuation and phrasing and changes nothing else. **Edit Text** stays for changes you describe.

- The microphone icon now means dictation (say what the reply should say, then the AI drafts it) on every channel. WhatsApp voice notes have their own ghost button labelled **Voice Note**.

## Faster Notes and PDF Export (29 October 2026)

Decided and built:
- Export as PDF only downloads the file. It is no longer attached back into the note.
- New Note opens at once: the note gets its id in the browser and the row is written in the background. Saves, pins, deletes and file uploads wait for that row; if it fails the note is taken out of the list with an error.
- Opening a note is warmer: the text and files of a note start loading when its row is pointed at or focused, the newest 8 notes' text loads in one request once the list is in, and pdf.js is loaded as soon as a note with a PDF opens.

Not done: nothing measured in a signed-in browser yet; decrypting a large sealed PDF still happens on the main thread.

## Code Review Fixes (2 November 2026)

A read-only review of the whole repository by seven agents, then fixes by six more, each owning its own files. Nothing
sends twice, row level security has no gaps, and no message content is logged.

### Decided and Built

- An outgoing email whose body or subject cannot be decrypted fails as Nothing Sent instead of going out blank.
- A feature with no entry in a user's AI allowance counts as out of budget, as the SQL always said. With empty shares in
  Admin, all AI pauses. Readable Bulk Email always gets a share (`20261115100000_review_fixes.sql`).
- The 20 pending draft cap also holds when a draft is changed to pending.
- LinkedIn, WhatsApp and Teams no longer move past a message that failed to save. A LinkedIn catch-up after downtime
  reads every changed conversation, not only the newest 20 (the first connect still reads 20).
- Paid Gemini answers are not thrown away and asked again: a failure after the call backs off the item, and a budget or
  billing pause is not counted as a try. Only 402, or a 403 that mentions billing, pauses AI for everyone.
- Shared chats remember being answered on the chat (`threads.answered_at`), so the 30 day outbox clean-up no longer
  makes them unanswered again.
- The voice learning counters on profiles are kept by a trigger, not a column grant, so new profile columns stay
  writable from Settings.
- AI prompts fence what senders wrote, and the contact and company summaries made from it, as untrusted.
- In the app: a failed key fetch shows an error instead of a blank inbox, a refresh after reconnecting merges into
  what changed meanwhile instead of overwriting it, and at most 60 conversations of messages are kept in memory.

### Decided (2 November 2026)

- Company summaries (`organizations.summary`) are encrypted (field `org_summary`), as they say what a company emails
  you. The AI worker seals new ones and seals old plain ones as it next reads them, with no new AI call.
- An email queued while its account is in error waits up to 10 minutes and goes out if the account recovers; after
  that it fails with "needs attention". A disconnected account still fails it at once.
- The setup allowance is already once per person per address (`ai_setup_grants`, 20261102100100): reconnecting the
  same address grants nothing new. No change.
- Atomic claims for every AI job: not yet. One AI worker is safe; add them before running a second AI worker or
  overlapping deploys, when both could pay for the same call.
- The Realtime feed of messages keeps its full rows: the body is sealed, and narrowing it means fetching each new
  message again in the app.
- A worker that finds its shard lease held waits one lease lifetime (about 90 seconds) before giving up, so a lease
  left by a killed worker (a dev reload saved twice in a row) runs out and the new worker starts late, not never.

### Not Done

- `20261115100000_review_fixes.sql` is written but not applied or dry run yet.

## Full App Review (2 November 2026)

Sixteen read-only reviews: one per sidebar page (Summary, Calendar, Inbox, Contacts, Attachments, Notes, Settings,
Analytics, Updates, Admin) and six across the app (security, channels, backend, AI, web app, strategy). The reports are
in `docs/reviews/2026-11-02/` on the owner's machine (kept out of git, as the security report describes open weaknesses), one file each, with file and line references. The owner agreed the recommendations, with
the changes below.

### Decided (2 November 2026)

- **Fix first:** ignore `captures/` in git (it holds LinkedIn captures with passwords and cookies), give the LinkedIn
  helper an allow-listed environment instead of every secret, stop Enter in the New Email fields from sending, stop a
  retry making a second outbox row, repoint every link when contacts merge, stop the setup dialog saving made-up
  people and style into real profiles, and stop email quote cutting at the first `>` line.
- **Developer setup comes out of Settings.** No terminal steps (`pnpm connect:*`, Cloud Console, env vars) are shown
  to users. They move to the worker README.
- **Security recommendations are agreed,** including the key route, KMS credentials, MFA, CSP and per-tenant worker
  isolation. The order is in the security report.
- **Baileys supply chain.** No fork for now. Instead: pin the exact version (no range), keep the reviewed source in the
  repo or a private mirror with a checksum, build the `whatsapp-rust-bridge` WASM from source, strip the WAM telemetry
  hooks, read the diff before every update, add a minimum release age and an audit to CI, and only ever install
  Baileys from the official repository (the 2025 "lotusbail" fork stole WhatsApp sessions). Later, WhatsApp sessions
  run in their own process holding only that user's keys.
- **Gemini key.** Before launch the AI worker gets its own Gemini key, separate from Mendr. Moving to Vertex AI for
  Google's Limited Use rules is part of the security work.
- **Multilingual replies: planned, not built now.** Drafts reply in the language of the conversation, which Gemini
  already follows from the thread. A "Reply In" option and a test set of mixed English, Afrikaans, isiZulu and isiXhosa
  messages come later. The interface (labels, buttons, the Summary) stays in British English.
- **Upload from cloud storage.** Attaching a file (replies, new emails, notes) can pick from Google Drive and OneDrive
  as well as the device, through Google's Picker (the non-restricted `drive.file` scope) and the OneDrive File Picker.
  The browser downloads the picked file and seals it like a local upload, so nothing changes in the privacy model.
  iCloud Drive has no web API: on Apple devices the system file picker already shows iCloud Drive, and the dialog says
  so.
- **Still to decide:** whether LinkedIn is paused until a paying customer asks (strategy) or kept (channels); whether
  Notes grows into linked client notes or stays as saved facts for drafts; the pricing in the strategy report.

### Automations and Lead Capture

Leads reach agents as emails from the portals (Property24, Private Property) and sometimes as SMS alerts. The email
comes from the portal's no-reply address, but the real person, their number, the listing and their question are in the
body. Today Konva files these under the portal. Automations fix that, and let users build their own.

An automation is **When, Read, Do**, set up in the web page like connecting an account:

1. **When** a message arrives on a chosen channel (an email account, the Konva SMS number, WhatsApp, or a forwarding
   address) and matches simple conditions: from address or domain, sender number, subject or body contains.
2. **Read** the fields out of it. Templates for known services use a fixed parser (free and exact). Custom automations,
   or a template whose email has changed, ask Gemini to fill the fields the user named, each with a one-line
   description (name, phone, email, listing reference, address, price, message). This counts against AI fair usage
   as its own feature.
3. **Do** any of: create or update the contact (matched on the number in +27 form and the email, so a repeat enquirer
   joins their existing record), mark them a Lead with the source, attach the listing to their client timeline, link
   the original message to them, add a task ("Call Back Within 5 Minutes"), write a reply draft to the lead's own email
   or WhatsApp (never the portal, and never sent without the user), and send an urgent notification.

**Templates first:** Property24 Enquiry and Private Property Enquiry, built from real enquiry emails read only, with the
parsers tested on anonymised copies. Then a Custom automation, then more templates as users ask (website contact forms,
Gumtree, Facebook Lead Ads, IOL Property).

**Turning one on** shows a preview: "In the last 30 days this would have made 14 leads", with the list, before it runs.
Every run is recorded so the user can see what it did and undo it.

**SMS: to do, not in this build (decided 2 November 2026).** Konva cannot read SMS on an iPhone, and the Android
bridge is unofficial. When it is built, SMS comes through a Konva number from a South African SMS provider with inbound
webhooks (to choose: Clickatell, BulkSMS or SMSPortal, checked for two-way long numbers and their price), which the user
points portal SMS alerts at. A per-user forwarding address for leads that land in an inbox Konva does not read comes
after that. Automations are built so either can be added as one more "When" channel.

**How it is built:**

- `automations`: user or team, template key, name, enabled, and the conditions, fields and actions as one sealed JSON
  (conditions can name people). `automation_runs`: automation, message, status, the sealed extracted fields, the
  contact made or updated, an error code. Both with row level security like every other table.
- The AI worker runs automations right after triage, since it already reads each new message: the fixed parser first,
  Gemini only when needed. Parsers live in `apps/ai/ai/automations/` with one file per template and tests in
  `apps/ai/tests`.
- The web app gets Settings, Automations: a gallery of template cards like the account cards, a builder for When,
  Read and Do, and the run history. Contacts gets a Leads filter.
- Effort: templates and the engine M, the custom builder M.

**Status: built in Wave 6, email only, not yet tested on real enquiry emails (2 November 2026).**

- `automations`, `automation_runs` and `automation_previews` (migration `20261120110000_automations.sql`, applied).
  The name, conditions, fields and actions are one sealed JSON (`automations.spec`); a run has the sealed fields it read,
  the contact, an error code and `effects` (ids only) so Undo can reverse exactly what it did. A message runs an
  automation once (unique on automation and message). Only mail that arrives after an automation is turned on, and is
  under three days old, is run.
- The engine is `apps/ai/ai/automations/`, called once from `Triage._triage_once` after the triage rows are saved. Read:
  the template's fixed parser, then Gemini only when there is no parser (Custom) or it failed, and only for an email
  that holds an address or number other than the user's. Gemini is filed under the new `automations` feature (3% share,
  weekly limit, taken from the largest share by the migration; Admin can change it) with a cap of 30 reads a person a
  day. Answers are checked: an address or number the email never contained is dropped.
- Do: find the contact by email and +27 number or make them, mark them a Lead (`contacts.relationship` is "Lead" only
  when empty, so a Client stays a Client) with `contacts.lead_source`, put the conversation on their timeline
  (`thread_participants`), queue a task through `task_updates`, queue a pending draft the normal draft loop writes in the
  user's voice with `drafts.reply_to` set to the lead's own address, and make the conversation urgent so the existing push
  sender sends its content-free text. Nothing is ever sent.
- Templates: Property24 Enquiry and Private Property Enquiry, with parsers built from constructed fixtures in the publicly
  known layout. **They must be tested against real enquiry emails (read only) before anyone turns them on.**
- Preview: turning one on asks the AI worker (`automation_previews`) to read the last 30 days with the same When and parser
  and shows "In the last 30 days this would have made N leads" with the list. Custom automations only count matching
  emails, since reading them would cost AI usage.
- Undo runs in the browser from the ids a run recorded: it removes the draft and task and the urgent mark, and deletes the
  contact only when the run made them and nothing else has happened to them.
- Web: Settings, Automations (template rows, Custom builder, run history with Undo); a contact shows its Lead Source; the
  Contacts Relationship filter lists Lead once anyone is one.
- Not done: the reply box must offer `drafts.reply_to` as the recipient (it still replies to the conversation's sender, the
  portal), so a draft for a portal lead must be addressed by hand until it does; a lead's listing is not attached to their
  timeline beyond the linked conversation; WhatsApp replies; SMS and the forwarding address (above).

### Build Order

Built by Sonnet agents in waves, each in its own git worktree and owning a fixed set of files, then reviewed and
merged by hand. Migrations get a timestamp block per agent, and `database.types.ts` is merged by hand.

1. Fix first and security (the items above, the worker URL limit, developer setup removal, Baileys hardening).
2. Split the oversized files (`thread-view`, `store`, `thread-list`, `attachments`, `contact-list`, the calendar page,
   `data`) without changing behaviour, and remove the X from every dialog.
3. Bugs on each page, one agent per page.
4. Core features: Undo Send and Send Later, snooze and remind-if-no-reply, web push, signatures, data export and account
   deletion, search, cloud file picker.
5. AI features: commitment tracker, scheduling replies, meeting prep, client summary card, noise cleanup, labels,
   daily brief v2.
6. Channels: WhatsApp safety limits, edit and delete history, labels, Instagram webhooks, Outlook calendar writes,
   Automations and lead capture (email only).
7. Client Timeline, Analytics and Admin views, operations (hosting, health, alerts).

### To Do, Not In This Build (2 November 2026)

- **SMS** (a Konva number for leads and replies; see Automations above).
- **The official WhatsApp Business Cloud API** next to Baileys, with Coexistence and Embedded Signup in the web page.
  It is also what a regulated compliance archive needs.
- **Billing:** Paystack subscriptions, trials, seats, EFT invoices for firms, VAT, and a plan page in Settings.


### Built: One iCloud Sign-In (2 November 2026)

Connect iCloud is now one Apple ID sign-in: the person ticks Mail, Calendar and Reminders, enters the code from an
Apple device in the page, and Konva makes the app-specific password Mail and Calendar need, labelled "Konva" in their
Apple Account (removable there). Agreed with the owner on 2 November 2026.

- **How the password is made.** Apple has no public way, so this follows account.apple.com's own calls, read from its
  JavaScript on 2 November 2026 (unpublished elsewhere): sign in at idmsa.apple.com with the account page's widget
  key (`af1139…82c3`, from account.apple.com/bootstrap/portal), open the session with GET
  `appleid.apple.com/account/manage/gs/ws/token`, then POST `/account/manage/security/secondary-password`
  `{"description": "Konva"}`. A 451 means type the password again (POST `/authenticate/password`); 466 means this
  Apple ID only makes them on a device. The sign-in reuses pyicloud's, so the code steps are the Reminders ones.
- **Where it runs.** `icloud_setups` (service role only, sealed under the static key, deleted once used) carries the
  sign-in, the code step and the made password. The iCloud connector process (`python3 -m ai icloud-reminders`)
  takes queued rows (`apps/ai/ai/connectors/icloud_reminders/setup.py`, `account_site.py`). The app's
  `/api/connect/icloud-signin/step` checks the password with iCloud Mail and Calendar and saves them exactly as a
  pasted one (`apps/web/lib/server/icloud.ts`).
- **What is kept.** For Mail and Calendar only the app-specific password, as before; the Apple Account session that
  made it is thrown away. Reminders, when ticked, starts its own iCloud.com sign-in afterwards with the trust token
  from this one, so Apple may not ask for a second code (not yet confirmed on a real account).
- **Fallbacks.** Use an App-Specific Password Instead keeps the paste form, for Managed Apple IDs (which cannot have
  app-specific passwords) and Apple IDs Apple refuses. Changing the Apple ID password revokes every app-specific
  password; Mail then fails to sign in and the person connects again. Apple allows about 25 per Apple ID.
- **Not yet checked against a real Apple ID.** The calls are read from Apple's code, not watched working. The first
  real sign-in should be watched: whether idmsa accepts the account widget key from a server, the exact shape of the
  make answer (the code takes any field shaped like `abcd-efgh-ijkl-mnop`), and whether the trust token skips the
  second code for Reminders.

### Built: Wave 3, Contacts Page (2 November 2026)

- A merge patches the contacts the app already holds (and the Contacts lists) instead of reading the whole contact
  graph again. Merge All shows one message with one Undo, reports pairs that failed, and has Merge Very Likely
  (score 0.85 or more). A split or an undo still reads the graph once. The list reads once per refresh, not twice,
  and Companies load only when the Companies tab or a search could need them.
- Last contacted ignores group chats, junk, newsletters and notifications (`contact_summaries()` rewritten).
  Companies are counted in the database (`company_summaries()`) instead of embedding every contact and thread.
- A person can say "This Is a Person" or "This Is a Company" (`contacts.kind_override`); it beats the guess. Hidden
  shows every hidden contact, company senders included.
- Edit lists every number whichever way it is stored (WhatsApp-only too) and removes it whole. Instagram handles and a
  LinkedIn link show on the contact, in search and in Message. Hide, person/company and Dismiss show at once and are
  put back on failure. A suggestion shows why (shared number, same name), whether it is very likely or possible, and
  who is kept.
- Search folds accents and takes words in any order; name order uses the South African collator and puts bare
  numbers last; no matches in People points at Companies and Hidden.
- Not done (decided to wait): relationship status, nudges, notes, VIP, pickers, import and export (built in Wave 4,
  below); `hidden` and `name_locked` in `merge_contacts`; passing the chosen name into `merge_contacts`; one shared
  role address list for web and worker; virtualising the list rows.

### Built: Wave 4, Contact Relationships (2 November 2026)

A light relationship layer on Contacts. It is not a CRM: no stages, scores, pipeline or custom fields (the Full App
Review "Do not add" list stands).

- **Status line** on every contact, computed and never typed, on the contact page (the list shows how to reach them and an unread count since 3 November 2026): "Waiting on you since
  Tuesday" when their message is the newest, "Waiting on them since Monday" when yours is the newest and under a
  week old, otherwise "You last wrote 12 days ago". `contact_last_touch()` returns the newest incoming and outgoing
  message per contact across channels, leaving out groups, junk, newsletters, notifications and the bin.
- **Follow Up** on a contact: In 3 Days, 1 Week, 2 Weeks or 1 Month makes an all-day "Check In With Sipho" task in the
  user's own task list through the same queue as New Task. The queue row carries `task_updates.contact_id`; a trigger
  on new tasks pairs the task with the oldest unlinked reminder of the same account and due time from the last 15
  minutes and sets `tasks.contact_id`. If nothing matches, the task still exists, just unlinked. Needs a connected
  task list; without one the menu says so.
- **Going Quiet**: starred people and clients (not hidden, not companies) with no contact for 14, 30 (default), 60 or
  90 days, longest silence first. A Contacts tab that appears when there is anyone. `goingQuiet()` in
  `lib/going-quiet.ts` is the selector the Summary card should call.
- **About note**: one free-text note per contact (`contacts.about_note`, sealed as `contact_about`), edited in Edit
  Contact and shown under Summary. Drafts get it as a separate fenced block, "What they wrote about this person", next
  to the AI's own notes (`apps/ai/ai/drafts_gather.py` reads it with one extra query, since `draft_context` and
  `compose_context` do not return it).
- **Star (VIP)**: `contacts.vip`. Starred people sort to the top of People and show a star. In triage their mail is at
  least important and never junk (an address the user unsubscribed from stays junk), and a settled bulk sender is
  still looked at when it is a VIP. Nothing hides a contact on its own today; the star keeps it that way.
- **Relationship picker**: Client, Prospect, Colleague, Supplier, Personal, Other, or Custom (typed), in New Contact
  and Edit Contact. The list has a Relationship filter (All, the six, any custom one in use), kept in the address
  as `rel=`.
- **Tidy Up** replaces the Suggested Merges row: possible duplicates plus people who only have a number or an address
  for a name, on `/contacts/tidy`, which links on to Suggested Merges and to each unnamed contact.
- **Export and import**: More, in the Contacts header. Export as CSV or vCard is read and written in the browser (a
  cell starting with = or @ is prefixed so a spreadsheet does not run it). Import takes a vCard or a CSV (our own,
  Google Contacts, Outlook style headers), up to 500 rows, shows a preview of what is new, what adds details to
  someone already here (matched by shared email address or phone number) and what is skipped, and saves nothing
  until confirmed. Matched people only get missing details; nothing they already have is overwritten.
- **Birthdays**: not built. Synced address book cards (`address_book_cards`) have only name, emails and phones columns,
  so there is no birthday data for the daily brief yet. To do: keep `BDAY` when cards
  are synced, then add a "Birthdays this week" line to `apps/ai/ai/brief.py`.
- **Not done**: a merge drops the merged contact's star and About note (`merge_contacts` is unchanged); the Summary
  card that uses `goingQuiet()` belongs to the Summary page; Going Quiet is not in the daily brief; no analytics
  events were added (new dialog names need adding to `packages/analytics`).

### Built: Wave 1, Fix First and Security (2 November 2026)

- The LinkedIn helper gets an allow-listed environment, not every secret.
- Baileys stays pinned exactly (7.0.0-rc14). CI checks its version and the sha256 of the WhatsApp WASM bridge
  (`scripts/check-baileys.mjs`), refuses packages younger than 7 days (`minimumReleaseAge`), and fails on high
  advisories in production dependencies. Next's postcss is overridden to clear two. Nothing in Baileys sends WAM
  telemetry and there is no switch for it, so that is documented. Building the WASM from source needs a Rust
  toolchain: written up in `apps/worker/README.md`, not done yet.
- The worker reads accounts and queues in slices of 100 ids, starts connectors in small staggered groups, wipes a
  WhatsApp session only on a real logout, and drops every log line from the signal libraries.
- Enter never sends from a single-line field. A failure that may have gone out shows May Have Been Sent with no
  Retry. A retry reuses the same outbox id, so it cannot send twice, and keeps Reply All and the From address.
  Queued and failed replies come back after a reload.
- Inbox keyboard: J and K (or [ and ]) open the next or previous conversation, Enter opens the first, E archives, # or
  Delete deletes, ! moves to or out of Junk, U toggles read, R replies, / searches, Escape closes. After archive,
  delete or junk the next conversation opens beside the list (the list on a phone). Rows show one marker, Urgent or
  Needs Reply; the open conversation shows the AI summary and, for email, its subject. A failed message load shows
  Retry. An archive, read or delete the provider refused is toasted with the worker's reason. A reply bubble says
  Waiting to Send, Sending or Sent as the outbox row moves. New Email ignores a click outside once you have typed.
- Merging contacts carries tasks, meeting participants, drafts and last senders along, and Undo brings them back
  (`20261116100000_merge_repoints_links.sql`, written, not applied yet). Local numbers ("082 ...") find contacts
  stored as "27...", and a sole trader writing from their own domain stays a person.
- The setup dialog saves nothing invented; the tour, the `/onboarding` mock and every terminal setup step in
  Settings are gone (developer steps are in `docs/CONNECTOR-SETUP.md`).
- AI: quotes are cut line by line (inline replies survive), Afrikaans and Outlook reply headers are cut, dashes become
  commas, all third-party text sits inside the untrusted fences, meeting summaries know who "you" are, follow the
  meeting's language and bill under transcribe, and a cut-short Gemini answer is logged as truncated.
- Two-factor sign-in (TOTP) in Settings, General, with a code step at sign-in. The key route refuses a session that
  has a factor but has not passed it. The owner must turn on TOTP in Supabase, Authentication, MFA. The CSP keeps
  `img-src https:` because email images load straight from senders; closing it needs an image proxy.

- Summary page, wave 3: the rail dot is the page's own Needs Reply plus Important count (`attentionCount` in
  `lib/summary.ts`), and `apps/web/lib/summary-fixture.json` is sorted by both the page and `brief.py` in tests so the
  spoken brief cannot drift. Conversations that aged out of the windows (unanswered over 3 days, urgent over 7) show
  as an Older section on the Summary itself (3 November 2026; was 14 days and a link to Inbox, Priority). The filter replaces the address and keeps the open conversation;
  archiving, deleting or answering the open one opens the next row on wide screens. `summary_shown` is emitted once a
  visit with section counts. Snooze and Waiting On Others came in Wave 4; draft chips are not built yet.
- Settings is six pages: Accounts (with WhatsApp Read Receipts and Resume Sync, no sign-in needed), AI (What Drafts
  Use, About, Writing Style, Priorities, Auto-Draft, Language, Daily Brief), Notifications, Usage, Team, and Profile
  and Privacy. Old addresses redirect from `next.config.ts`. Push, Urgent, Important and Quiet Hours work
  (see Web push and PWA, Wave 4). A failed Settings save puts the screen back. About and
  Important People are sealed (`profile_about`, `profile_people`); older plain rows are sealed the next time the
  profile loads, and the AI worker reads both. Display name is still plain.

## Calendar page, Wave 3 (2 November 2026)

- **Sync window:** every calendar connector keeps 90 days back and 365 days ahead (`apps/worker/src/calendar/sync-window.ts`).
  Outlook has no cheap change check, so it polls only the near part (7 days back, 60 ahead) every five minutes and the whole
  window hourly. Past events that slide out of the back of the window are never deleted. Beyond a year ahead the page says
  Not Synced (`apps/web/lib/sync-window.ts` keeps the same numbers). Nothing is fetched on demand beyond the window.
- **Live page:** the Calendar page subscribes to `calendar_events` (Realtime; `20261117100000_calendar_events_realtime_and_range_index.sql`,
  written, not applied yet) and reloads when the tab comes back after a minute away. The search box is now Filter This View:
  it filters the events and tasks loaded for the days shown, not every synced event.
- **Join Meeting for every provider:** Google (location and notes as well as Meet) and Outlook (onlineMeeting and the body)
  find Zoom, Meet, Teams and Webex links the way iCloud does. Google's HTML notes are stored as text.
- **Removed:** scroll to change day or week, and right click to create an event. Drag, double click, the New Event button
  and N remain. N is a new event and Shift N a new task.
- **Not done:** sealing `calendar_events.attendees` (see the encryption section), choosing which calendar a new event goes in,
  Outlook creating and changing events (the sign-in is read only).

## Web push and PWA, Wave 4 (2 November 2026)

- **Push is real.** `apps/web/public/sw.js` (registered from the app shell by `PwaBoot`) shows a push and opens `/inbox/<id>` on
  click. It has no fetch handler and no cache, so it can never store an authenticated page or API response. Settings,
  Notifications saves the subscription to `push_subscriptions` (`lib/use-push.ts`); iPhone and iPad must add Konva to the Home
  Screen first. Needs `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; keys come from `pnpm --filter worker vapid:generate`.
- **Sender:** `apps/worker/src/push` (primary shard, every 20 seconds; needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`, otherwise off). It pushes a thread whose newest message is unread, from someone else, in the inbox, not junk,
  under 30 minutes old and Urgent or Important. Urgent ignores quiet hours; Important respects them (read in `profiles.timezone`);
  the Urgent and Important switches apply. `threads.push_notified_at` (migration `20261118120000`) makes each message push once,
  also when it was held back by a setting. A person gets at most 6 pushes per 10 minutes. 404 and 410 delete the subscription.
- **Content-free:** the payload is fixed words plus the thread id ("New message from a client"), never a name, address or text.
  End-to-end sealed payloads are not built; the push service sees only that something waits.
- **PWA:** 192 and 512 icons, maskable versions (`pnpm --filter worker pwa:icons`), `id`, `scope`, shortcuts (New Email, Summary),
  and a text share target that opens New Email at `/new-email`. The app badge shows unread inbox conversations. Shared files
  are not handled yet.

## Wave 4: Linked Notes

- A note can be linked to contacts, conversations and calendar events (`note_links`, ids only). A Notes chip (`NotesChip`) lists a target's notes and starts a linked one.
- Quick capture: Cmd+Shift+N (linked to the open conversation or contact), `useCaptureNote` for other screens, titled with the conversation subject.
- Create Note From Summary makes an editable note from a meeting summary, linked to its event and attendees. No AI call.
- Extract Tasks turns unchecked checklist items into tasks through `task_updates`; the task notes name the note and client.
- Templates: Call Note, Meeting Note, Quote, Onboarding Checklist. Archive keeps a note out of the list and out of drafts (use_in_drafts is switched off).

## Composer, Wave 4 (2 November 2026)

- **Signatures:** one per send address (every email account and alias), written in Settings, Accounts, Signatures as plain text with line
  breaks. Kept in `account_composer.settings`, a JSON object sealed in the browser with the user's key (migration
  `20261118150000_composer_signatures_templates.sql`, written, not applied yet). The web app adds the signature below an email's text
  when it queues the send (`lib/signature.ts`), never to WhatsApp, LinkedIn or Instagram, and never twice: text that already ends with
  it is left alone. Drafts and AI drafts are kept free of it. The AI worker is told not to write its own signature block (the sign-off
  phrase only) when the plain flag `account_composer.has_signature` is set. The reply box and New Email show the signature under the
  text with a per-message **No Signature** toggle. The worker send path is unchanged.
- **Writing As:** the From address is a normal button (not rounded) (Writing As, address) in the reply box and New Email, with the same choice of addresses.
  Settings, Accounts has a **Default Send-From** for each account with more than one address. It decides only when the latest email
  does not say (the address it was sent to still wins), and it is sent along with the reply so the worker agrees.
- **Templates and Snippets:** your own, in Settings, AI, Templates and Snippets (`user_templates`, title, shortcut and body sealed).
  Variables `{first_name}`, `{name}`, `{company}` and `{my_name}` are filled from the contact and your profile; one with nothing to
  fill it stays visible and the reply box warns before sending. Snippets expand when you type `;shortcut` and a space. The template menu
  now shows in every chat, with the team's templates added in a work chat.
- **Suggest Times:** a permanent calendar button in the reply box, New Email and New WhatsApp that adds three free times (the same
  `freeSlots` as guided drafting).
- **One-step Draft:** the draft bar has a **What Should This Say?** field; Enter or Draft drafts at once. The Draft dialog is gone;
  Edit Text keeps its dialog. Edit (was Edit With AI) already holds Fix Typos and Grammar, Edit Text and the tone changes in one menu.
- **Draft Tone:** Settings, AI, Behaviour, Draft Tone (Match How I Write, Formal, Friendly, Brief) in `profiles.draft_tone`. The AI worker
  reads it for a draft written afresh; a tone picked for one draft still wins, and edits ignore it.
- **Not done:** per contact domain default send-from; signatures with images or HTML; the worker adding a signature for sends that do
  not come from the app.

## Snooze, reminders, labels and Deleted, Wave 4 (2 November 2026)

- **Snooze:** `threads.snoozed_until`, `snooze_kind` and `snoozed_at` (`20261118110000_snooze_labels.sql`, written, not applied
  yet). A snoozed thread is out of every inbox view and the Summary until the time passes; the Snoozed view lists them,
  soonest first, with Unsnooze. Choices: Later Today (before 15:00), Tomorrow, This Weekend (weekdays only), Next Week
  (all 08:00 except Later Today at 18:00) and Pick a Date (08:00 that day). H opens the choices; Snooze is also a row
  button, a menu item and a bulk action. Nothing runs to bring a thread back: the store schedules one redraw for the next
  due time (`use-snooze-clock.ts`). A new inbound message clears the snooze in the database (trigger, only for a message
  sent after the snooze was set). A thread that came back wears Snoozed for 24 hours.
- **Done for Now:** the Summary row button snoozes to tomorrow at 08:00. The Summary's bulk Snooze opens the choices.
- **Remind Me If No Reply:** offered when you wrote last; 1, 3 or 7 days or a date. It is a snooze of kind `reminder`,
  so the thread leaves Inbox and returns on the date with a Follow Up tag (up to 7 days, until they or you move it on). A
  reply cancels it. `follow_ups` (the AI's note that a message expects an answer) is not reused: it has no time.
- **Labels:** `labels`, `thread_labels` and `saved_views`, all row level security on `user_id`. Label and view names are
  sealed with the user's key as field `name`. Colours are nine stock palette names. Labels are set from the thread menu, the
  row right-click menu and the bulk bar; the Inbox shows a chip per label (`?label=`). Deleting a label removes it everywhere.
  Not live across tabs yet.
- **Saved Views removed (3 November 2026).** The owner saw no purpose in them, so the "..." list menu went with them and
  By Person moved into the Filter menu in the Conversations title row. The app no longer reads or writes `saved_views`; the
  table stays (Download My Data still exports old rows and account deletion still clears it) until a migration drops it.
- **Every page on one design (3 November 2026).** Conversations and Summary set the scheme; every other page now follows it,
  built from shared parts: `components/surface.tsx` (PaneColumn, Card, StatCard, IconCircle, Row, Separated), PaneHeader's
  `views` and `search` (a 40px views row and a 40px search under the 40px title row, level with the rail) and `IconAction`
  (a ghost icon button with its tooltip). List and pane have no border between them; the pane is grey with white cards.
  Dialogs drop the corner X for a plain button row; taglines and helper text are cut. Same control sizes on phones.
  - **Settings** is a list beside a grey pane, with Search Settings over every section and setting (`lib/settings-index.ts`).
    Sections: Profile, Notifications; Accounts (one Sending card); AI, Drafts (templates and learned data), Automations;
    Team (its four sub-pages are views); Usage, Privacy and Data (split from Profile); What's New; Updates (owner only, the
    changelog editor moved out of Admin). `/whats-new` and the old Team pages redirect.
  - **Admin and Analytics are one owner-only page** at `/admin`: Overview, Usage, AI, System, Flags, Teams, Audit, Logos.
    `/analytics` redirects there and the rail lost its Analytics item.
  - **Contacts, Notes, Calendar and Attachments**: Filter menus in the title row instead of rows of selects, views and search
    in the header, 40px rows with channel badges, detail pages as cards (Contacts: number cards then Timeline and Overview),
    an empty pane of number cards and cards. Calendar's grid sits in one white card; No Date is a view; phones get a seven
    day strip over the agenda. Attachments keeps its grid of white tiles on grey, selecting in the views row's slot.
- **Add to Calendar from a message (3 November 2026).** When triage offers reply choices for a message that proposes something
  with a date (a trip, a meeting, a booking), it also returns a plan: a short title, the first day (with a time when given), the
  last day or end time, and the place, sealed inside `reply_choices` with the choices (no extra call). The reply box shows Add to
  Calendar on the right of the choices, which opens New Event filled in. New Event now takes From and Until for an all-day event
  over several days. Only messages triaged after the AI worker release have a plan.
- **Summary redesign (3 November 2026).** Same header as Conversations: a 40px title row with the date ("Tue, 3 November") on the
  right beside Listen, Refresh and Filter, then a 40px Search Summary that narrows conversations, events and tasks. The headline
  line under it is gone. With nothing open, the pane beside it is Your Day: Replied Today, Waiting On Others and Promises, today's
  brief as text (the script was play-only before; it is the user's own and sealed), and the week as one row of seven days.
- **Deleted view:** read on demand (the store does not hold trash), newest 200, with Restore (email also queues `untrash`).
  Delete Forever is not offered: the mail action path has no permanent delete and non-email chats have nothing to remove at
  a provider. The 30 day auto-empty is still not built.
- **Waiting On Others:** replaces Unread in the Summary filter. It lists inbox threads where you wrote last, the AI says an
  answer is expected and none has come for 2 days, quietest first; the usual sections give way to it.
- The daily brief skips snoozed threads like the Summary does (`brief.py`).

## Search, Wave 4 (2 November 2026)

- **One engine, private by construction:** Cmd-K and the Inbox list search both read a local index (`apps/web/lib/search`). The
  server never sees search text, and analytics still count only the length of a query and how many results it had.
- **What is indexed:** every conversation and message (paged through the whole history in the background, 250 at a time,
  newest first, resuming where a closed tab stopped), contacts, notes (title and the start of the text), calendar events, tasks
  (dated or not) and attachment names. Message text is cut to 600 characters, notes to 4,000, and messages are capped at 150,000
  and files at 100,000 (the oldest drop first), so memory stays bounded.
- **Where it lives:** built and searched in a Web Worker from text the page has already decrypted, held in memory, and saved in
  IndexedDB in 512 shards, each sealed with AES-GCM under the user's field key (name of the shard bound in as additional data).
  A key that cannot open it (another user, a rotated key, damage) clears it and the build starts again. Sign-out clears it.
  If a Worker cannot start, the same code runs on the page. First build shows "Indexing N of M" in the palette footer.
- **Kept current:** the app's own conversations, contacts and tasks are diffed into it as they change; Realtime on messages,
  notes and calendar events (each on its own channel) updates or removes documents; a tab that was hidden for two minutes
  catches up on messages when it returns.
- **Operators:** `from:`, `to:` (both accept `me`), `has:attachment`, `is:unread`, `before:` and `after:` (a day such as
  2026-11-02, a month, a year, today or yesterday). Words match in any order, ignoring case and accents. Quoted text is a phrase.
- **Result groups:** Conversations, Messages, Contacts, Notes, Events, Tasks, Files. A message opens its conversation at that
  message, loading the conversation first if it is older than the 1,000 the list holds. Phones get a Search Everything bar above
  every list page that opens the same palette.
- **Limits:** the Inbox list can only show conversations it has loaded (the newest 1,000); older ones are found in the palette.
  Messages in a binned conversation that is not loaded are not yet left out. Search never reads the event `attendees` column
  through the address keys, so it uses it as stored (see the sealing item above).

- **Not done:** sealing `calendar_events.attendees` (see the encryption section). Choosing a calendar and Outlook writes
  came in Wave 4 below.

## Calendar page, Wave 4 (2 November 2026)

- **Copy Free Times:** a clock button in the Calendar header opens a dialog that copies "Thursday 14:00 to 15:00, Friday 09:30
  to 10:30" for the next 3, 5 or 10 working days, or for dates picked on a calendar. Working hours default to 08:00 to 17:00,
  Monday to Friday (no setting existed), and are changed in the dialog and remembered in the browser. Gaps are at least 30
  minutes (or 1 or 2 hours), on the quarter hour, at most three a day. All-day events do not block time, except ones over several
  days; every timed event does, declined or not (offering a taken time is worse than leaving one out). The sums are in the
  browser's time zone (`apps/web/lib/free-times.ts`).
- **Schedule from a conversation:** `<ScheduleButton thread={thread} />` (`components/schedule-button.tsx`) opens New Event with
  the people in the conversation as guests (their first email) and the subject, without Re: and Fwd:, as the title. The AI
  proposing the time is not built.
- **Invitations in conversations:** `<InviteCard message={message} />` (`components/invite-card.tsx`) reads the .ics an email
  carries and shows Accept, Maybe and Decline, answered through the same calendar_updates path as the Calendar page. The
  file is matched to the stored event by start and title (the file does not carry the calendar's own id); if the sync has not
  stored it yet the card says so and offers Check Again. A repeating invitation is answered for the whole series.
- **Calendar picker:** New Event lists every calendar of every connected calendar account (learned from the stored events, as
  there is no calendar list table; read-only ones such as holidays are left out) and each account's default, kept in the
  browser. iCloud now creates in the chosen calendar.
- **No Date:** tasks with no due date are loaded and listed under a No Date row below the search box on the Calendar page, and a
  task can be made without a date (a time still needs one).
- **Outlook calendar writes:** create, change, delete and answer go through Microsoft Graph in the worker, the same queues
  Google uses (`apps/worker/src/microsoft/calendar-write.ts`, `connectors/outlook-calendar.ts`). Needs Calendars.ReadWrite,
  asked for later on its own (incremental consent, Allow Editing, back through the same Microsoft sign-in) so an organisation
  that has not approved it cannot block the first sign-in. Until then each write is refused with a message that offers the button.
  Outlook always invites guests, so Send Invites is not offered and guests with it off are refused; repeating Outlook events
  cannot be made from here. Migration `20261118190000_outlook_calendar_events.sql` lets the outbox take Outlook accounts.
- **Answer for the whole series:** the Reply row has a switch for every event in a series (Google, iCloud and Outlook; Outlook
  answers on the series master). A change to a series that does not move its time also goes to the master in Outlook.

## Promises and Daily Brief v2, Wave 5 (2 November 2026)

- **Promises:** the follow-up check (`chasers.py`) already reads the end of each conversation where you wrote last; the same
  call now also lists clear promises in those two messages (`{text, owner me or them, due, evidence message}`), so no extra
  Gemini call and the cost stays under the `triage` feature. Stored in `commitments` (`20261119100000_commitments.sql`, written, not
  applied yet): text sealed as field `task_title`, `due_on` a day, `unique (message_id, seq)`. The app can only tick one Done or
  snooze it. A promise is only found in conversations the check reads, so a promise of theirs is caught when you replied last.
- **Surfaces:** a Promises section on the Summary (yours due within 2 days or late, theirs late, each with Done and Snooze) and
  a Promises strip under the summary in an open conversation (both owners, yours first).
- **Missed promises of theirs:** the morning after the day (08:00 South Africa) with no message from them since, the AI worker
  sets the conversation's snooze to a reminder that is already due, so it is in Inbox wearing Follow Up (up to 7 days). A snooze
  to a later time, a snoozed promise and an archived conversation are left alone. The Follow Up mark no longer needs you to have
  written last, since a reply after the reminder clears it in the database.
- **Daily Brief v2:** adds Waiting On Them (conversations you wrote last that expect an answer, 2 to 14 days, with days, at most 3
  in the prompt), promises due today or late (at most 4) and tomorrow's first timed meeting with one prep fact (an open promise
  with a person named in its title). Same 80 to 160 word budget: these are the first lines dropped when it runs long.

### One Person, One Conversation (Wave 5)

- **By Person:** a toggle in the Inbox list's "..." menu (`group=person` in the address) shows one row per contact, merged contacts included,
  with the channel icons and the newest message. A row opens `/inbox/person/<contact id>`: that person's email, WhatsApp, LinkedIn
  and Instagram messages in date order, a channel badge on every message (a link that opens that conversation). The reply box goes
  out on the channel picked, the channel of their last message to begin with. Opening the timeline only loads messages; nothing is
  marked read, so no WhatsApp read receipt goes out, until the user opens a conversation from a badge. At most 12 conversations a
  person are loaded into the timeline. Groups stay rows of their own.
- **Same Matter?:** `apps/ai/ai/matter.py` pairs an email thread with a chat of the same one-to-one contact when they were last
  active within 14 days and the mean of their sealed message vectors (`similar.py`) has cosine 0.80 or more (0.76 within 2 days).
  From 0.68 a pair is borderline and goes to the model only through an injected `confirm`, at most 5 a run, billed under `learn`
  (which already pays for embeddings); with none supplied it is dropped. Rows go to `thread_links` as `suggested`
  (`20261119170000_thread_links.sql`, ids and a score only); Link Them makes them show together under a matter heading in the
  person timeline, Not the Same stops the suggestion for good. Not wired yet: nothing calls `matter.suggest` on a schedule.

### Client Timeline and Matters (Wave 7)

- **Timeline tab:** a contact's page opens on Timeline when they have any conversation (Overview otherwise). One list, newest
  first, grouped by day (`apps/web/lib/timeline`, `components/timeline`): messages of every one-to-one channel (not newsletters),
  meetings with their summary, notes linked to the contact, promises (open and done), tasks about them, documents that have a
  card, and leads an automation captured. Each row has a type icon and a link to its source. Search and a type filter work on
  what is loaded.
- **Paging:** messages load 40 at a time (newest first) with a Load Earlier button; things older than the oldest loaded message
  wait for the page that reaches them. The page only reads: nothing is marked read, so no WhatsApp read receipt goes out.
- **Matters:** per contact, a short name (60 characters, sealed under the `name` field) and a kind (Deal, Listing, Policy,
  Matter), open or closed (`20261121100000_matters.sql`: `matters`, `matter_links`, ids only). A conversation, note, file or
  meeting can be put in one or more matters from the plus on a row; linking a conversation brings its messages, promises and
  files. Pick a matter above the timeline to see only that job. Deleting a matter keeps what it held. No stages, values or
  pipeline view, on purpose.

### Draft Facts, Feedback and Voice Replies (Wave 5)

- **Fact guard.** After a draft is written, `drafts_facts.py` checks that every amount, number (10 and over), date, weekday,
  time, phone number, email address and web address in it appears in what it was written from: the conversation, the
  instruction and decision, saved facts, your note about the person and your next 14 days of calendar (times and days only,
  never titles). Amounts, times and dates match by normal form (R 4 500 is R4,500; 2pm is 14:00). Placeholders (`[Name]`,
  `{x}`, `<Name>`, TODO, TBD) are found too. A report with anything missing makes one more try at temperature 0.2 (first try
  0.6) with the unsupported details named; the better of the two is kept. The report is stored sealed in `drafts.report`.
- **Chips and audit.** Under an untouched AI draft the app shows green Found and amber Check This chips and a line such as
  "Based on: last 3 messages, 2 saved facts, your calendar" from `drafts.audit` (counts only). Nothing blocks sending.
- **Thumbs.** Thumbs up, or thumbs down with an optional reason from a closed list (Too Formal, Too Casual, Too Long, Too
  Short, Wrong Facts, Wrong Language, Not Like Me), stored on the draft and read by `signals.py` beside the other signals.
  Wrong Facts and Wrong Language teach no style rule.
- **Rules per channel.** `style_rules.channel` is `any`, `email` or `whatsapp`. Existing sent mail and edit rules became
  email rules. WhatsApp drafts leave out email rules, and `voice.py` learns WhatsApp rules from your sent WhatsApp messages
  on their own counters (`profiles.voice_whatsapp_*`), with a prompt about chat habits.
- **Voice notes.** A voice note sent to you shows View Transcript and Reply With These Points, which asks for a draft that
  answers every point, in the language spoken (the interface stays British English).

## Document Cards (Wave 5)

- The AI worker reads a PDF, or an image whose name looks like a document, and keeps a sealed card on the attachment: type
  (invoice, quote, contract, ID, statement, proof of payment, other), who it is with, amount and currency (rand unless the document
  shows another), due date, reference and a one-line summary. The file's own words are treated as untrusted.
- It happens when someone presses Read Document in the viewer, and for PDFs and document-like images from people in the contacts list
  (never bulk mail, last 14 days). Photos and chat images wait to be asked for.
- Counted in AI Fair Usage as Document Cards, starting at 4% of the monthly maximum with a weekly limit. A person is capped at 15
  automatic reads and 40 reads in all per UTC day.
- The Attachments page shows the type and amount on a tile, the full card in the viewer, and filters for Invoices, Contracts, Proof of
  Payment, Quotes, Statements and IDs. A dated card becomes a task ("Invoice due 30 Nov") in one click. The card's words are in the
  private search index, so "invoice from Sipho" finds the file.

## Triage labels, reasons and Clean Up, Wave 5 (2 November 2026)

Migration `20261119120000_triage_labels_reasons.sql` (applied).

- **Auto labels:** up to 6 labels can be marked Auto in Manage Labels, each with a one line description (sealed with field
  `name`). Triage sends them numbered, between marked lines, and the model returns one number or `none` in the same call (one
  more enum field, no extra call). The worker puts at most one Auto label on a conversation (`thread_labels.auto`), never one
  that is junk, never a second, and never one the user took off: a trigger on `thread_labels` deletes writes
  `thread_label_removals`, and putting the label back by hand clears the row.
- **Why:** triage stores a reason code from a closed list plus a few words (`triage_reason`, sealed `triage_reason_text`) on
  `message_ai` and `threads`. The user's own signals set fixed words ("You unsubscribed from this sender"). The web reads them on
  demand (hover or tap of the Urgent or Needs Reply tag, and a line under the open conversation's header) with Not Right?:
  Not Junk, Not Important or No Reply Needed. No Reply Needed is a new `feedback` value the AI honours and lists in corrections.
- **Why removed (3 November 2026).** The owner found the reasons often wrong ("Starred contact" on someone not starred, "No
  reason was saved"), so the hover card, the line under the header and Not Right? are gone. Urgent and Needs Reply stay as plain
  tags; Mark as Important / Not Important stay in the conversation menu. Triage no longer asks the model for a reason or writes
  one. `20261123100000_drop_triage_reasons.sql` drops `triage_reason` and `triage_reason_text`, applied after the AI worker release.
- **Suspicious mail:** `suspicious` (`payment_change`, `phishing`, `impersonation`) from the same call, shown as a warning
  banner in the conversation. It never blocks, deletes or drafts anything.
- **Cost:** junk gets no summary from the model (the subject stands in). Reply choices are only for messages that ask about a time
  or for a decision, and the idle choices backfill is removed (old unanswered messages rarely get answered).
- **Clean Up:** Inbox, Subscriptions, Clean Up (`/inbox/clean-up`). Bulk senders with nothing opened and mail at least 90 days old,
  worked out from the loaded conversations with no AI. Unsubscribe All asks first and uses the existing unsubscribe path; Mark as
  Junk moves their conversations to Junk. Nothing is done until a button is pressed.

### Wave 5: AI Cost and Reliability

- **Batch API:** setup triage (old mail, 6 hours or more, of someone still inside the setup allowance) and learning backlogs
  (4 or more edits in a pass, or any during setup) go through the Gemini Batch API at half price, with the same prompts. Live mail
  and anything that cannot be batched (refused budget, failed or expired job, unreadable answer) is asked the ordinary way.
  Jobs are remembered in `ai_batches`, so a restart collects them instead of asking again; rows waiting on a batch are held out of
  triage with `messages.triage_hold_until`. `AI_BATCH=off` turns it off.
- **Claims and lease:** drafts, triage groups and voice notes are claimed through `claim_ai_rows` before they are paid for, and the
  AI worker takes the lease `ai` like the sync worker's, so a second `pnpm ai` stops at start. Triage back-off lives in `ai_retries`.
- **Draft latency:** an idle draft poll waits at most 1 second (was up to 10). Waking from Realtime needs a websocket client the
  worker does not have; the indexed read is cheap.
- **Learning:** one set of rule helpers (`rules.py`) for all three learners. Edits are learned from only when larger than the
  person's median edit (once they have 20 outcomes). A rule from a single edit starts off (`tentative`) and goes live at support 2.
- **Cost records:** context cache storage is recorded (estimate $1.00 per million tokens per hour). Audio input is priced per model
  where a rate is on record ($0.50 3.1 Flash Lite, $1.00 2.5 Flash), else the $3.00 estimate, which still needs checking against
  Google's page.

## Closing known gaps, Wave 7 (2 November 2026)

- **Merging keeps the star, About note and lead source.** `merge_contacts` now ORs the star (`vip`) and keeps the kept contact's
  About note and lead source, else takes the merged one's (relationship, company and role already worked that way). When both
  have an About note the kept one stays; the other is not lost, because `contact_merges.merged_snapshot` holds the whole merged
  row and Undo inserts it back. The three columns are recorded in `kept_before` and `kept_after` so Undo restores them unless
  changed since. Migration `20261121130000`, patched in place like `20261116100000`.
- **Download My Data covers the later features.** Added: labels (and which chats wear them), saved views, templates and snippets,
  signatures (and default send-from), promises and automations with runs (already there), note links, linked chats, client cards,
  document cards and edited or deleted message versions. `export-coverage.ts` lists every table with a `user_id` column as exported
  or excluded with a reason, and its test reads the migrations, so a new table cannot be left out unnoticed. Known gaps, marked
  "Not yet" in that file: unsent drafts, meetings (notes, summaries, transcripts) and the learned style rules. There is no
  matters table, so nothing to export there.
- **No LinkedIn reactions from the app.** `lib/reactions.ts` is the one list of channels a reaction can be sent on (WhatsApp only).
  The react button, the reaction chips (shown but not tappable on other channels) and the store action all follow it. To switch
  LinkedIn on: add the `react` command to both LinkedIn helpers (Go bridge and `apps/ai` connector), then add "linkedin" to
  `REACTION_CHANNELS`.
- **Tentative style rules say so.** In Settings, What Drafts Use, a rule seen once and still off shows "Learning: seen once"; the
  switch turns it on now, and Remove deletes it.
- **Customer wording.** Time-out messages no longer tell people to check that a worker is running.

### Built: Wave 7, Admin for an Owner-Operator (21 November 2026)

Admin gained five sections beside AI Usage, AI Budget, Teams and Updates. All are owner only (`is_analytics_owner`), and
all show counts, ages, codes and dollars: never message content, names or addresses, and never "view as user".

- **Health:** a lease per sync shard and the AI worker's `ai` lease (red when run out, amber when a renewal was missed), and
  each queue's depth with the age of its oldest waiting row: outbox (waiting and sending), drafts, mail actions, task
  updates, calendar writes, automation previews and AI batches. Thresholds are in `lib/admin-ops.ts` (`QUEUES`). Below it,
  connectors: accounts by provider and status, the oldest good sync among connected accounts (heartbeat or last sync;
  amber past 1 hour, red past 6), and error codes over 24 hours from the content-free analytics events, so people with
  Share Usage Data off are not counted.
- **AI History** (under AI Usage): month over month for everyone, and per person a 30 day sparkline, this month against
  last, and cost per feature. Includes setup work and logos, because it is what Google bills.
- **Flags:** `feature_flags` (key, enabled, optional people). On means the switch is thrown. Seeds: `pause_all_ai`,
  `pause_predrafts`, `pause_documents`, `pause_automations`, `disable_connector_instagram`, `disable_connector_linkedin`,
  `disable_sends`. Read with a 15 second cache by both workers; a worker that cannot read the table runs with every switch
  off. Choke points: the AI budget check (`gemini_budget._check_budget`: all AI, documents, automations), the pre-draft
  gate (`drafts_gather._limited`), the outbox claim (`send/outbox.ts claimReady`: a held row stays queued, Undo works), the
  sync worker's connector reconcile (LinkedIn) and the Instagram connector's reconcile. The web app can ask
  `feature_flag_state()` for the signed-in person's switches; nothing in the app reads it yet.
- **Alerts:** a list worked out from the live numbers, no emails: billing paused, a lease run out (or no AI lease), daily AI
  spend past a limit the owner sets (amber from 80%, default $20, stored in `admin_settings`), a configured model with no
  price (the AI worker writes `ai_status.unpriced_models` at start), and a stuck queue. The tab shows the count. A
  content-free web push to the owner is not built; the existing push sender would need a job for it.
- **Audit:** `admin_audit`, written by database triggers on budget saves, switch and setting changes, seat changes, new teams
  and request decisions: who, when, old and new values (numbers, flags and ids only). Changes made with the service role are
  not logged.

Migrations `20261121110000_feature_flags_audit.sql` and `20261121111000_admin_operator_views.sql` are written, not yet applied.

## Hosting For Daily Use (agreed 2 November 2026)

- **Web app on Vercel**, project `konva` in the `prowse` team, built from `apps/web` on every push to `main`. Functions run in
  Dublin (`dub1`) because the Supabase project is in AWS Ireland, so each request reaches the database without leaving the region.
- **Until launch, the workers run on the owner's laptop** (`pnpm worker` and `pnpm ai`) against the same Supabase project, and the
  phone uses the live site. Mail, WhatsApp and drafts only move while the laptop is awake with both running. Agreed 2 November
  2026, to avoid paying for a server before anyone else uses Konva.
- **Before launch: workers on one Google Compute Engine VM**, `konva-workers` in `africa-south1-a`, in the `messages-keys`
  project next to the KMS key. The VM's own service account can only encrypt and decrypt with `user-data-keys`, so the workers
  need no key file. Docker Compose runs the sync worker, the AI worker and, when switched on, the iCloud Reminders and Instagram
  processes. Chosen over Cloud Run because the workers hold long connections (WhatsApp, IMAP) and poll in a loop, and over a
  cheaper VPS elsewhere (Hetzner, about $5 to $7 a month) because South African hosting matters for POPIA once clients are on
  it, and Confidential Space (stage 4) is the same project and region. The scripts in `deploy/` are written; the VM is not created.
- **VM size: e2-small (2 GB) or e2-medium (4 GB)**, decided at setup. Estimated monthly cost for one user (check the Google
  Cloud calculator before creating it; price sites disagreed in November 2026):

  | Item | e2-small | e2-medium |
  | --- | --- | --- |
  | Machine, running all month | about $13.50 | about $27 |
  | 30 GB balanced disk | about $3.50 | about $3.50 |
  | External IPv4 address | about $3.65 | about $3.65 |
  | Network out, one user | under $1 | under $1 |
  | KMS key (already paid) | $1 to $2.50 | $1 to $2.50 |
  | **Total** | **about $22** | **about $35** |

  e2-small only works if the images are built elsewhere (GitHub Actions pushing to Artifact Registry), because building on the
  VM needs more than 2 GB; e2-medium builds on the VM as `deploy/release.sh` does now. A one-year commitment takes about 37%
  off the machine. Add a watchdog that restarts unhealthy containers (Docker only restarts crashed ones), stop the laptop
  workers once the VM holds the leases, and set `ERROR_TRACKER_DSN` so failures are noticed.
- **The LinkedIn helper is now built into the worker image** as a static Go binary, so LinkedIn works in production.
- **Releases** build on the VM from a pushed commit (`deploy/release.sh`, default `origin/main`), never from the working tree.
  Secrets are copied from local env files by `deploy/push-env.sh` and `deploy/push-web-env.sh` and live only on the VM and in Vercel.
- For one user, the Google OAuth app is published without verification so Gmail sign-ins do not expire after 7 days in Testing
  mode. Verification (with the security assessment for Gmail scopes) is needed before other people sign in.

## Mobile Feedback Pass (3 November 2026)

The owner's iPhone feedback, with evidence per item, is in `docs/reviews/2026-11-02/mobile-feedback.md`. Decided and built:

- **Dialogs:** stock X top right, no Cancel. AlertDialog confirms keep Cancel. The onboarding setup dialog stays without an X.
- **Fields are 14px everywhere.** iPhones get `maximumScale: 1` (set from the user agent in `app/layout.tsx`) so focus does
  not zoom; pinch zoom still works there. iPads report a Mac user agent and still zoom on focus.
- **Status bar:** the shell pads `env(safe-area-inset-top)` on a solid background, so iOS has no see-through band over the top.
- **Pickers:** month and year in every date picker are shadcn Selects; one `TimeSelect` (15 minute steps) in New Event, New
  Task, Send Later and Copy Free Times.
- **Calendar on phones:** header and month grid stay put and are shorter; only the list scrolls. New Event fills the screen on
  phones, with guest suggestions inline under the field instead of a popover.
- **Summary:** Needs Reply covers 3 days (`REPLY_DAYS`, web and `brief.py`); Older is a section on the page. Urgent counts as
  important 24 hours after the latest message (`URGENT_HOURS`). The channel filter (Summary and Inbox) lists the channels you
  have. A past asked-about time drops a conversation to Older once `Thread.askedAt` is filled (not yet: needs a plain
  `threads.asked_at` written by triage).
- **Urgent:** only a same-day deadline, a real money or security problem, or something lost today. Someone waiting on you is
  important and needs a reply. No reason line when none is stored; the tag is grey, never red. Automations write the reason
  `automation`. Triage calls chats messages, not email.
- **No red delete buttons** anywhere outside destructive confirms.
- **Conversation header on phones:** Notes, Schedule and Sharing move into the "..." menu.
- **Contacts list:** phone, Instagram and email under the name; unread count summed across channels under the date.
- **Notes:** New Note makes a blank note, templates have their own icon button; Pin, Archive and Delete appear on swipe
  (`components/use-row-swipe.ts`, for other lists later); the toolbar re-measures the keyboard while it settles.
- **Attachments:** no People filter; Read Document only offered for PDFs and document-named images; the viewer has the X and
  icon buttons for Download and Delete.
- **AI paused:** a requested draft or document read fails at once with "AI is paused for now. Try again later." instead of
  waiting. Pre-drafts and briefs still wait. Brief requests are looked for every 2s, the first spoken part is about 20 words,
  and Listen only rewrites when a conversation the brief would mention moved on. Previews are looked for every 5s.
- **Automations:** Turn On no longer waits for the preview. Cost estimate: about USD 1 to 2 per user a month, mostly the draft
  each lead gets.
- **Settings:** compact desktop nav like the rail; larger section headings; Usage shows AI before storage.
- **Not server rendered, on purpose:** content is decrypted in the browser, so pages stay client rendered. Native feel comes from
  shell caching, skeletons and gestures (proposed, not built).

Waiting on the owner: draft wording ("What Should This Say?"), automatic calendar availability in reply choices, the AI memory
as an editable written summary, how much settings text to cut, and shell caching.

## Control Sizes on Phones (3 November 2026)

- Desktop and tablet keep 32px controls (`h-8`). Below `md` (phones), buttons, icon buttons, inputs, input groups, select
  triggers and toggles are 40px (`max-md:h-10`, set once in `components/ui`), so they are easier to tap. Small sizes (`sm`,
  `xs`) and the date picker's day grid keep their size.
