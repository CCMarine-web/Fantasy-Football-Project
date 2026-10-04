# The Rat Trap: Site Audit

October 2026, during the 2026 season (week 4 in progress, weeks 1-3 final).

This file is the working record for the polish pass. **Phase 1** (site audit) and **Phase 2** (data accuracy) are here. The voice work is in [VOICE-GUIDE.md](VOICE-GUIDE.md) and the image plan is in [ASSETS.md](ASSETS.md).

---

## How the audit was done

- **Production build, run locally.** `next build && next start` against the live database.
- **Every route at two widths.** A Playwright crawl visited 44 URLs at phone width (390px, iPhone 13 emulation) and at desktop width (1440px). That covers every public page, sample dynamic pages (a played game, an unplayed game, a 2025 playoff game, a 2017 ESPN-era game, a manager, a rivalry, two seasons, a weekly issue), all 12 admin screens, `/chat-lore`, `/championship-belt/edit` and a 404.
  - For each URL the crawl recorded the HTTP status, redirects, load time, console errors, page errors, failed requests, horizontal overflow, Open Graph and meta tags, and the visible text. It took full-page screenshots and fed every internal link into a dead-link check.
- **Screenshot review.** The screenshots were sliced into screen-sized tiles (151 phone, 84 desktop) and reviewed visually, page by page.
  - Chrome blanks full-page captures past about 16,000 device pixels, so the lower parts of the tallest phone pages were checked against the text dumps.
- **Code review.** Four parts of the code were reviewed separately:
  - every server action and admin page, for authentication and role checks;
  - the theme tokens and hard-coded colours;
  - card, heading and table consistency;
  - every user-visible string and every page's metadata.

### Results at a glance

| Check | Result |
|---|---|
| HTTP status | **All 44 routes 200**, correct redirects for every protected page, and a 404 for the unknown URL |
| Page errors (uncaught JS) | **0** |
| Console errors | Only on `/championship-belt/edit` (fixed) and the deliberate 404 |
| Dead internal links | **0 of 130** |
| Horizontal overflow at 390px | 1 page (manager profile, by 4px; fixed) |
| Gold/yellow leftovers | Crash-screen button, light-mode token, amber C grades, 🏆 emoji chip (all fixed) |
| Secrets in the browser | None found; no `NEXT_PUBLIC_` variables; `.env*` never committed |

### Performance (warm server, local machine to us-east-2)

| Page | Response time | Note |
|---|---|---|
| `/records`, `/rivalries`, `/power-rankings`, `/trade-tribunal`, `/hall-of-shame`, `/managers` | 10-110 ms | Served from the data cache |
| `/standings` | 220 ms | |
| `/` | 620 ms | Partly uncached |
| `/history/[season]` | 1.3-1.5 s | Uncached |
| `/matchups` | 1.5 s | Uncached |

These timings include about 50-80 ms of round trip per query from this machine. On Vercel (iad1, near the us-east-2 database) they will be lower. See "Should fix" below.

---

## Fixed in Phase 1

### Security

| Issue | Fix |
|---|---|
| **Login had no rate limiting.** Unlimited password guesses against the admin account, which protects the private chat archive. | A database-backed throttle: 5 failures per email, or 20 per client address, in 15 minutes locks that key for 15 minutes. The lock is checked before the password, so a locked account costs no bcrypt work. It lives in the database because serverless instances don't share memory. New table `LoginThrottle` (migration `20261004230000_login_throttle`), with tests. |
| **Login response time revealed which emails have accounts.** | An unknown email is compared against a dummy bcrypt hash, so a missing account and a wrong password take the same time. |
| **Sessions were never re-checked.** A demoted admin or a deleted user kept access for as long as the 30-day cookie lived. | The JWT callback re-reads role, manager link and deleted status every 5 minutes, and ends the session if the user is gone. |
| **The public manager page could trigger paid AI calls and show rejected drafts.** With no saved profile, each anonymous view generated one (up to 4 model calls). A draft the editorial guard had rejected for naming the private group chat was returned (unsaved) and shown. | The page is now read-only (`getSavedManagerPerformanceSummary`). Profiles are generated only by `scripts/ai/regenerate-manager-profiles.ts`. |
| **Marking history or knowledge SENSITIVE/REDACTED did nothing.** No public page or AI prompt filtered on it. | Every public and AI read now requires `sensitivity: "NONE"`. |
| **An unpublished or rejected Hall of Shame photo stayed public for up to an hour.** `revalidatePath` doesn't clear the data cache behind the page. | Media and punishment actions now call `updateTag` on the league and manager cache tags. |
| **Three admin pages relied on the proxy alone** (`/admin`, `/admin/punishments`, `/admin/managers/[id]`). | Each now checks the role itself, as the other nine already did. |
| **`/championship-belt/edit` sits outside the proxy**, so a signed-out visitor got the generic "couldn't load this page" error (React #441). | Added to the proxy, so it redirects to sign-in. |
| **The cron endpoint was open when `CRON_SECRET` was unset.** | Now fails closed (503) in any production build. See the follow-ups in the commit history. |
| **A member could overwrite a commissioner-entered (locked) prediction** while the season was open. | Refused. |
| **The site could be framed** (clickjacking). | `X-Frame-Options: DENY` and `frame-ancestors 'none'`, plus `nosniff` and a referrer policy. |
| **`npm run db:seed` had no guard.** It wipes every table, so pointed at production it would have erased the league. | Refuses whenever a season is linked to Sleeper or ESPN, unless `SEED_WIPE_REAL_DATA=yes-delete-everything`. |
| **The login page sent visitors to "seeded demo accounts listed in the project README"**, and the README prints a demo admin password. | Copy removed. Checked production: no demo accounts exist (one admin account under a different domain). |

### Broken or misleading pages

| Page | Issue | Fix |
|---|---|---|
| Matchup detail (where group-chat links land) | Every final, past and future game showed a permanent "Chart coming soon" card | Removed |
| Matchup detail | "Placeholder (mock AI)" and "AI content status: not generated" badges shown to members | Removed. Mock text is never shown. Empty states read as intentional and put the recap first once a game is final. |
| Matchup detail | **"Patrick Schwing leads the series 7-10"**: it always named the first-listed team | Names the actual leader, leader's wins first; ties read "Series tied". |
| Matchup detail | No `<h1>`, a generic "Matchup" title, no way back, robot avatars, no winner marker, and the final/vs divider hidden on phones | Real heading and status line, a "← Week N matchups" link, manager photos, the winning score in blue, and the divider shown at every width. Title and link-preview text are per game ("A vs B — Week 3, 2026", plus the final score). |
| 404 | The stock white Next.js page | A branded `not-found.tsx` with links to Matchups and Home |
| Matchup of the Week | **"0th in the table"** on every team | During the season the standings rank is now the position in the table (wins, then points for, the order Sleeper ranks by). The stored rank is still used for finished seasons. This also fills the all-dash "#" column on Standings. |
| Matchup of the Week | The form strip contradicted the record ("0-3" next to "L L W"). It reached into last season, left out the game on screen and ran newest first. | This season only, through this game once it is final, oldest first, matching the standings table |
| Matchups hub | "Updated through Week 17" when week 17 (unplayed) was picked in the selector | Shows how current the data is, plus a separate "Viewing Week N" chip |
| Matchups hub | The jump link "Streaks & Records" didn't match its section ("Streaks & Season Marks"). An ESPN-era explanation appeared for an empty 2026 wire. | Names matched, and the explanation now depends on the era |
| Home | Week 4 cards labelled "Up next" while LIVE | "In Progress — Week 4" while the week is live |
| Home | Every transaction labelled "Free-agent pickup", drops included (Sleeper files a drop as `free_agent`) | Labelled by what moved (Drop, Add/Drop, Waiver claim + drop), with team and week |
| Home | The empty-season state gave members developer instructions and an admin button | Member copy |
| Home, belt card | "Belt history →" clipped at the card edge on phones | The row wraps |
| Managers | **Four bios cut mid-number** ("…averaging 105."): the excerpt treated a decimal point as a sentence end | Decimals are masked before splitting into sentences, with a regression test |
| Managers | "1 finals"; a gold 🏆 emoji in the "Best" chip | Singular form; "Best: 1st" |
| Manager profile | A mock scouting report shown with "add an OPENAI_API_KEY" | Treated as absent |
| Manager profile | Luck breakdown at one word per line; page 4px wider than the screen | Phone layout stacks label, bar, then description (agent F1) |
| Predictions | The submit page invited signed-out visitors to sign in and pick after the lock | Shows "locked" with a link to everyone's picks |
| Predictions | A stale or missing draft date could unlock a season already past its draft | Locked once a season is past its draft, whatever the config says |
| Draft Report Cards | A developer note about `OPENAI_API_KEY` shown to every visitor | Removed |
| History index | Season cards stacked with no gap (inline `<a>` ignored `space-y`) | `block` links |
| Season history, weekly news | Every season titled "Season History" and every week "Weekly Recap", in tabs and link previews | `generateMetadata` per season and per week. The model-written headline wraps on phones. |
| Rivalries | "1 meetings" | Pluralised |
| `/chat-lore` | A leftover mock of the import flow (sample people, "not wired in this build") | Redirects to the real `/admin/chat-import` |
| Admin dashboard | "Manage Mappings" and "Chat Import" were disabled, although both pages exist. The footer said most actions were placeholders. | Linked, and the footer is accurate |
| Error pages | Members were told "the league database may need to be configured or synced" | Plain member copy |

### Theme and design consistency

| Issue | Fix |
|---|---|
| **About 17 intended Card outlines and hover states never rendered.** `Card` drew its edge with a ring, so every `border-*`, `hover:border-*` and `border-dashed` class on a Card was a 0px border. That included every matchup-card hover, the featured matchup, Matchup of the Week, the belt feature and failed-claim cards. | `Card` now has a real 1px border, so all of those classes work as written. |
| Crash screen's "Try again" button still old gold (#e6b325) | Brand blue, and the background matches the site |
| Light-mode `--gold` token still #eab312 (dormant only because dark mode is forced) | Set to blue, so it can't resurface |
| **Win green failed WCAG AA** (3.4:1 as small text in about 12 places) | Lighter green for text (passes AA); solid green fills now carry dark text |
| Trade Tribunal "Clear Winner" was identical to "Fleeced" after the gold-to-blue remap, so the 5-step verdict ladder showed 4 styles | Clear Winner is a step-down tint |
| Amber C-grade chips on Draft Report Cards | Non-gold scale (agent F2) |
| Sentence-length badges clipped mid-word on phones (`whitespace-nowrap` + `overflow-hidden`) | Badges can wrap within the screen width |
| The masthead had zero slack at 360px and overflowed below it | Tighter tagline below 400px |
| Nav said "Championship History" for the Championship Belt page | "Championship Belt" |
| Stock create-next-app SVGs in `/public` | Removed. The favicon is still the stock one; replacing it is in ASSETS.md. |

### Phone layout and page-level fixes

| Page | Issue | Fix |
|---|---|---|
| Rivalries | Names in the head-to-head row truncated past recognition ("Patric… 10-16 Patric…") | Each manager on their own line with their win count. Consistent precision (1 decimal; 2 when a margin is under a point). |
| Rivalry detail | "Every meeting" showed one manager's score; the other score and the result were off-screen with no cue | A compact phone list ("2025 · Wk 17 PO", "A–B" with the winner highlighted, "X won"). Names under the avatars are padded and wrap. |
| Standings | Names truncated ("Marvin's Ro…"); hidden columns gave no hint | Names wrap, the avatar is hidden on phones, and a "More columns on a wider screen" note shows. (Reachable columns are Must fix 4.) |
| Manager profile | Luck breakdown at one word per line; 4px horizontal scroll | Stacks on phones; `min-w-0` / `break-words` |
| Power Rankings | Factor values wrapped onto two lines ("89.8% of / optimal"); mixed precision | Label and value on one line over a full-width bar; 1 decimal throughout |
| Championship Belt | "RUNNER-UP" wrapped; crown icons shrank to different sizes per row | `shrink-0` icons, "2nd" on phones, tighter cells |
| Drafts | Defences truncated ("Houston Texans Team D/…"); long player names cut | "Houston Texans D/ST"; names wrap to two lines |
| Season history | Bracket sections in random order (consolation first, semifinal last). 2025 showed 8 single-team "Playoffs" cards. "W-L-T" wrapped. The manager name split across lines. ESPN seasons said "No scoring data yet". Gaps around decimals in monospace prose. | Fixed order (Championship → Semifinal → Quarterfinal → placement → Consolation). Games with fewer than two teams dropped. "W-L" (ties only when present). The manager always on its own line. An ESPN-era explanation. Body-font numbers. |
| Transactions | Every type badge the same dark green at 3.4:1, so Drop looked like Add | A distinct style per type, all at least 4.5:1 |
| Draft Report Cards | Amber C grades. "ESPN does not expose that" shown for 2026. A lowercase sentence start. The ADP caveat repeated. | Non-gold grade scale (A green, B blue, C grey, D/F red); the hindsight note depends on the season; copy fixed |
| Trade Tribunal | "2.0× the average haul" (always exactly 2.0 when the loser got nothing); mixed numeral fonts; header and verdict precision disagreed | "Winner got N% of the value in the deal", one numeral style, 1 decimal. One verdict reads "walked away 54 points…" (missing "with"). That is stored AI text, so it is regenerated in Phase 3. |
| Records | Closest game read "0.08 pts" over "122.9-122.8" | Scores to 2 decimals when the margin is under a point |
| Hall of Shame | The last-place intro said "for this season" over a multi-season table | Reworded |

---

## Link previews (what a texted link shows)

**Before this pass:**
- No page had Open Graph or Twitter tags, `metadataBase`, or an image.
- A link texted to the group chat unfurled with at most the page title and the same site description on every page.
- Matchup, season and weekly-issue links all had identical titles.

**After Phase 1:**
- Matchup, season and weekly pages have their own titles and descriptions.
- A final game's preview text carries the score, for example "Final: Patrick Schwing 125.3, Michael Shea 115.1".

**Phase 4** adds code-generated preview images and `metadataBase`. See ASSETS.md.

---

## Suggestions (not implemented; for your review)

Ordered within each tier by impact.

### Must fix

1. **Live scores during a game week.**
   - **Problem:**
     - On a Sunday, Home and Matchups show the in-progress week as LIVE with every score "—". Scores are only stored once a week is final, which is deliberate: it is what stopped unplayed weeks being stored as 0-0 results. The page still reads as broken.
     - The Matchups hub also opens on the last completed week rather than the live one.
   - **Suggestion:**
     - Read live points straight from Sleeper for the in-progress week at render time (cached about 60 seconds) and label them "Live". Never write them to the database.
     - Default the hub to the live week.
2. **League members can't sign in.** Production has exactly one account, the commissioner's.
   - Predictions are member-only, so nobody else can submit picks.
   - **Suggestion:** create an account for each manager before the 2027 draft. Better still, add a passwordless sign-in (an emailed link or a one-time code sent from the admin screen), so the league doesn't need to manage passwords.
3. **Phone page length.**
   - Power Rankings is about 11.5 screens, a manager profile about 11, Managers about 10, Matchups about 10.
   - **Suggestion:**
     - Collapse the methodology and each team's factor breakdown behind "How it works ▸" / "Score breakdown ▸".
     - Clamp bios on the Managers list to 3 lines with "Read more".
     - Show the first 5 transactions with "Show all".
     - Make last week's results on Home a compact 5-row list.
4. **Standings on a phone hide five columns** (PA, all-play, expected wins, schedule luck, form) with no way to reach them.
   - **Suggestion:** a horizontally scrollable table with a sticky team column and a swipe hint (the manager career table already does this).

### Should fix

5. **One set of layout primitives.**
   - **Problem:**
     - There are five content widths (3xl to 7xl), so the title jumps sideways between pages.
     - There are four section-heading styles, four table styles, and three info-callout styles.
     - Translucent hand-rolled boxes sit next to solid Cards on the same page.
   - **Suggestion:**
     - Use two or three widths (a wide hub and a reading width).
     - Promote the Matchups hub's `SectionHeading` to `components/shared`.
     - Add a single `Callout` and a single `DataTable`.
     - Use one surface opacity.
6. **Type scale and tap targets.**
   - **Problem:**
     - 41 arbitrary text sizes (10-13px) sit below the scaled `text-xs`.
     - Several controls are under 44px: the week picker chips (about 30px), season pills (24px), login inputs and buttons (about 31px), the mobile menu button (32px) and the transactions Search button (28px).
   - **Suggestion:** a `text-2xs` token if a smaller step is genuinely needed, and `min-h-10` or more on every tappable chip.
7. **Retire the `gold` token name and add a warning colour.**
   - **Problem:** `text-gold` now renders the brand blue, 27 call sites use it, and the name misleads. The stale-data warning and PENDING statuses now look exactly like brand callouts.
   - **Suggestion:** rename `gold` to `primary` (or a deliberately named `trophy` token), and give warnings their own hue. Not amber, since the brand is moving away from gold; a desaturated coral or violet would work.
8. **Matchup pages for unplayed and ESPN-era games.**
   - **Problem:** two large "No lineup data" boxes fill most of the screen.
   - **Suggestion:**
     - Unplayed games: one compact "Upcoming" card (kickoff, records, players to watch).
     - ESPN games: a single line, "Lineups weren't recorded for 2017-2022".
9. **Uncached hub pages.**
   - **Problem:** `/matchups`, `/history/[season]` and parts of `/` recompute on every request (1.3-1.5s from here).
   - **Suggestion:** wrap their loaders in the existing `cached()` helper with the league tag, which the weekly refresh already invalidates.
10. **Feature names.**
    - **Problem:** the nav and the page titles disagree. "Season History" vs "League History", "Records" vs "League Records", "Transaction Archive" vs "Transactions", "News Archive" vs "News", "Predictions" vs "Preseason Predictions".
    - **Suggestion:** pick one name per feature, and write "Week 5" everywhere (not "wk 5", "Wk", or "week 5").
11. **Emoji-only team names.** The team named "❤️" renders as a lone heart where a name should be.
    - **Suggestion:** for very short or emoji-only names, add the manager name ("❤️ · Patrick Schwing").
12. **Home duplicates the featured game** in the week list just below it. The Matchups hub already leaves it out.
13. **Store pending media outside `/public`.** Every imported image, approved or not, is served statically and committed to git. Approval only controls whether it is *listed*. Low risk today, since everything in `/public/league` is already public.
14. **`import "server-only"` in `env.ts`, `db.ts` and `auth.ts`.** This needs the scripts and tests to run under the `react-server` condition, or a small shim, so it is a small project rather than a one-line change.
15. **Sign-in UX.** When a protected page redirects, say why ("Sign in to continue to Admin"). Add `autocomplete="email"` / `current-password`.

### Nice to have

16. **A real win-probability chart** built from Sleeper's live projections. This replaces the removed placeholder.
17. **Previous/next navigation** between a week's matchups and between weekly issues.
18. **A darker backdrop behind the mobile menu.** The dialog and sheet scrim is `bg-black/10`, which barely dims a dark page.
19. **Charts use `--chart-1..5`** instead of hard-coded `var(--gold)` / `var(--primary)`.
20. **Admin hints** ("A commissioner can add one from the admin manager editor") shown only to admins.
21. **One tagline.** The Home hero and the footer say the same thing in different words, and "since founding" reads unfinished without a year.
22. **The remaining disabled admin buttons** (League ID, Seasons, AI Settings, Review Queue, Corrections). Build or remove each. Phase 3 wires "AI Settings" for the voice and off-limits topics.
23. **Delete the unused `components/shared/error-state.tsx`.**

---

## Security review summary

- **All 32 exported server actions** check the session and the right role themselves before doing anything. This matters because Server Actions can be called directly by POST from anyone who knows the action ID.
- **Members can't touch another manager's prediction** or set the admin override.
- **No open redirect.** The callback URL is constrained to the same origin.
- **No secrets reach the browser.**
- **The private chat archive** (`ChatMessage`, imports, participants, receipts, knowledge) is read only by admin screens and offline scripts.
- **Everything the review found is fixed above**, except the media-storage item (Should fix 13) and `server-only` hardening (Should fix 14).

---

# Phase 2: Data accuracy and freshness

A full reconciliation, not a spot check. Every feature that shows a ranking, score, record or piece of history was recomputed independently from the raw stored games by two separate verification passes. Each number was compared with what the site's own code produces and, for Sleeper seasons, with Sleeper itself.

## 1. Contamination from the old cron bug

Before the Oct 4 fix, unplayed 2026 weeks 4-17 were stored as FINAL 0-0 games (Sep 8 - Oct 4).

**Stored data.** I scanned every stored, derived table for rows written in that window.

| Stored data | Written during the bug window? | Result |
|---|---|---|
| Power-ranking blurbs, trade verdicts (`AIBlurbCache`) | No (last written Jul 29) | Not contaminated. Power-ranking blurbs were *stale* preseason text and are now hidden (see 3). |
| Manager profiles (`ManagerPerformanceSummary`) | No | Not contaminated, but written preseason: they quote pre-2026 career numbers (see "AI text to regenerate") |
| Records (`LeagueRecord`) | Table unused (0 rows) | Records are computed live |
| Rivalries (`Rivalry`, `RivalryMeeting`) | No | Stale instead: they stopped at 2025. Now recomputed weekly (see 3). |
| Standings snapshots | No (none for 2026) | — |
| Weekly awards | Yes: 33 awards for unplayed weeks 4-14 | Deleted. Awards now come only from FINAL games, and a week with none has its awards cleared. |
| Draft grades, predictions, receipts, knowledge, punishments, championships | No | Not contaminated |
| AI recaps (`AIContentGeneration`) | Yes: 16 recaps of fake week-17 0-0 games | Deleted (by you). Guards now refuse any recap of an unplayed game. |
| Player-level scores (`Roster` / `WeeklyPlayerScore`) | Yes: rosters for unplayed weeks 4-17 | Cleared by the corrected sync; only final weeks keep player scores |

**Live-computed features.** Records, Hall of Shame, streaks, all-play, luck, head-to-head and power rankings read the stored scores on every request. While the 0-0 games existed they *were* contaminated on the live site, for example a 0.00 "lowest score". They healed the moment the sync stopped storing scores for unplayed weeks; nothing they computed was ever saved. Verified now:
- no record or Hall of Shame entry is held by a 0.00 score or an unplayed week;
- the three zero scores in the database are unverified, abandoned-team scores and already excluded.

## 2. Reconciliation: `npm run verify:data`

New, reusable, read-only. It recomputes the key numbers from scratch and compares them with the source:

- **Sleeper seasons (2023+).**
  - Every team's stored W-L-T and points for/against are checked against Sleeper's roster totals, to the hundredth.
  - The same totals are recomputed from the stored games, which catches a single bad game even when the totals look right.
  - Every stored score of every final week is checked against Sleeper's matchups endpoint, along with whether the two sides were really opponents.
- **ESPN seasons (2017-2022).** Totals recomputed from the stored games are checked against the season totals ESPN reported at import.
- **Weekly.** The weekly cron runs it for the current season right after each sync (a new VERIFY step). A mismatch marks the run PARTIAL and writes the disagreement into the audit log; it does not stop the run.

**Results (all ten seasons):**

| Season | Source | Teams | Scores | Result |
|---|---|---|---|---|
| 2017-2022 | ESPN import | 58 | 812 | All reconcile |
| 2023 | Sleeper | 10 | 170 | Reconciles |
| 2024 | Sleeper | 10 | 170 | Reconciles. Two **source discrepancies**: Sleeper's season total for Sad Team's points-for (1458.98) and Robbery Part 8's points-against (1713.22) are each exactly 1.00 below the sum of Sleeper's *own* weekly scores. Every weekly score matches ours, so there is nothing on our side to correct. Reported, not counted as errors. |
| 2025 | Sleeper | 10 | 170 | Reconciles |
| 2026 | Sleeper | 10 | 30 | Reconciles |

**Fixed during reconciliation:**
- **Points for/against were truncated** for every Sleeper team (438 instead of 438.10). The sync read Sleeper's `fpts` and ignored `fpts_decimal`. This is the standings tiebreaker.
- **Commissioner score overrides** (`custom_points`) were ignored. There are none in this league's history, but the official score is now honoured.

## 3. Feature by feature

| Feature | Checked | Result and fixes |
|---|---|---|
| **Power rankings** | All 10 teams, every factor, recomputed independently; #1 and #6 by hand | Arithmetic matched exactly. Four problems fixed: **(a)** Movement arrows never showed: last week's order was never computed. It is now derived from the same model without this week's games (week 3: Barkemeyer ↑2, Fuentes ↑1, Javier ↓3). **(b)** A factor identical for every team ("Recent form" through week 3) was kept at 12%, contrary to the method text. Flat factors are now dropped and the weights rescaled. **(c)** "Optimal lineup" ignored positions (it could start two QBs), understating lineup efficiency by up to 10 points. It now uses the best *legal* lineup, using the real starter slots now recorded by the sync and backfilled for 2023-2026. This moved Schwing to #3 and Cibilich to #6, as the hand check predicted. **(d)** Preseason blurbs contradicted the cards ("dead last… 18.3" on #3) and are hidden until rewritten. Rankings recalculate every week: derived on read, with the cache cleared by the cron. |
| **Standings** | 2026, all teams: W-L-T, PF, PA, all-play, expected wins, luck | Matches (after the decimals fix). The in-season rank column now numbers 1-10. |
| **Records** | Highest/lowest game, blowout, closest, streaks, season marks | Matched; none held by a 0.00 or unplayed score. Fixed: best and worst season record and most points in a season were won by three weeks of 2026 (3-0 / 0-3); only completed seasons count now. Tied streaks (9 wins: McManus & Fuentes; 10 losses: Javier & Barkemeyer) showed one holder chosen by row order and now name both. |
| **Hall of Shame** | Every entry, last place in all 9 completed seasons | Fixed: "Worst season ever" was 2026's 0-3 and is now Javier's 1-13 (2024). 2026 was listed as a final last place and now isn't (completed seasons only). The bench record was inflated by position-agnostic "optimal" lineups (102.5) and is now 79.5 against a legal lineup. |
| **Rivalries / head-to-head** | 3 pairs against a recount; profile H2H against career totals | Fixed: stored rivalry stats stopped at 2025. They are now recomputed by the weekly cron (the commissioner's workbook still decides which pairs are official, and the 5 official flags are preserved). **Consolation-bracket games** were counted in rivalries (51 meetings) and on the manager page's head-to-head, career points, and highs and lows, while both pages say they aren't. One rule site-wide now: not counted. |
| **Manager careers and Luck** | 2 managers, every figure and all 5 Luck inputs | Matched. Fixed: best and worst season picked the 3-0 2026 start, and now completed seasons only. "Playoff berths" counted 2026: Sleeper's provisional bracket flagged all 10 teams as playoff teams at week 3. The sync now ignores the bracket until a postseason game is played, and those flags were cleared. Luck's "postseason draw" compared playoff opponents to their *career* average instead of that season's. |
| **Weekly awards** | 2026 wk 1-3, 2019 wk 7, 2024 wk 14 recomputed | Boom, bust, luckiest and unluckiest matched. Bench Blunder used the position-agnostic optimum, and the winner differed in 19 of 45 Sleeper-era weeks. Recomputed for 2023-2026 with legal lineups. Backfilled 2017-2022. |
| **Trade Tribunal** | All 13 trades from every season against the database; window logic | All present (2026 has none yet). **Hindsight counted points the old owner scored:** the trade's own week was credited to the receiver even when the player played that week for the sender (8 of 13 trades; one winner flipped, four bands changed). Now the trade week counts only when scored on the receiving roster. **Provisional verdicts** for the current season are built: labelled on the card, re-scored weekly, the verdict rewritten only when the hindsight winner flips, and finalised after the championship. Failed or vetoed trades are excluded. 5 old verdicts still matched the corrected ruling and quote no figures, so they stay. 8 are held back until rewritten. |
| **Draft report cards** | All 10 seasons' composites recomputed | Stored scores and letters are current, and 2026 uses only pre-draft data. **Needs your call:** letters come from *rank* on a fixed curve, so a D is impossible in a 10-team league, 22.9 gets C- while 22.3 gets F, and three tied pairs got different letters. See "Your call" below. |
| **Predictions** | Scoring logic | None submitted in any season, and 2026 shows a clean empty state. Fixed: "last place" was scored from the Toilet Bowl result, which disagrees with the site's last place in 6 of 9 seasons; it now uses the same regular-season rule. |
| **Championship Belt** | Titles per manager, current champion, counter | Matched. The reign counter now starts the night of the title game (Mon Dec 29, 2025) instead of Jan 1. |
| **Season summaries** | 2025 and 2019 champion, runner-up and standings; 5 numbers in the 2025 article | All match |
| **Weekly pipeline** | End to end | Re-syncs keep recaps linked (matchup ids are stable). A full cron run takes about 25s, against Vercel's 300s limit. Nothing is generated for unplayed weeks (guarded at four storage points, with tests). |
| **News** | — | The archive listed no 2026 weekly issues and now lists every final week. |

**Stored vs live.** Everything stored is now refreshed after each sync:
- weekly awards, rivalry statistics and current-season trade verdicts, by the cron;
- standings, records, Hall of Shame, luck, head-to-head and power rankings, derived on read.

Draft grades are written once (draft day) and revisited once (after the season), by design.

## 4. "Updated through Week X"

Every data page now carries a line such as "Updated through Week 3, 2026 · synced Oct 4, 5:41 PM CDT". It comes from what is actually stored: the latest week with final scores and the last successful sync. If the cron stops, the line visibly stops moving.

## AI text to regenerate (in the new voice, once approved)

Not rewritten in the old voice, as you asked:

- **8 trade verdicts** held back: 2023 W3, 2024 W2 (Detillier ↔ Cibilich), 2024 W10, 2025 W3, W4, W8, W9, W10. Their ruling changed or they quote figures that moved.
- **10 power-ranking blurbs:** preseason text, hidden.
- **10 manager profiles and scouting reports:** written preseason; they quote pre-2026 career numbers (for example "62-64" where it is now 65-64) and a few old team names.
- **Draft grade write-ups:** only if you change the grading curve (below).

## Your call

1. **Draft grading curve.** Letters are assigned by rank on a fixed curve, which makes a D impossible and separates near-identical scores by a full grade.
   - **Recommended:** absolute thresholds on the 0-100 composite, with equal scores always sharing a letter.
   - Changing it changes stored letters, so the write-ups should be regenerated at the same time, in the new voice.
2. **Lineup slots.** The draft model and the trade model still assume one FLEX; 2026 starts two. Small effect; fix alongside 1.
