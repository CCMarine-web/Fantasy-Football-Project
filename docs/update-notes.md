# Update: luck, data correctness, charts, domain and search

Branch `update/luck-charts-domain`. Spec: `rat-trap-next-update-prompt.md` (audit of Nov 15, 2026).
This file is the PR description: inspection findings first, then what changed per phase.

## Inspection findings

### The Luck Score that was live (src/server/stats/luck.ts, `computeLuckScore`)

Inputs: one manager's verified game log and every verified team-week score in the span (one season for the
season figure, all seasons for the career figure). Regular season only for components 1-4; consolation games
never enter (the verified loader keeps them, but every component filters `!isPlayoff`, and component 5 uses
`bracket === "WINNERS"` only). Unfinished weeks have no stored scores, so they never enter.

Each component is a deviation clamped to [-1, +1], positive = lucky:

| Component | Weight | Raw measure | Scale (= ±1) | Minimum to count |
|---|---|---|---|---|
| Wins vs expected | 0.40 | actual win rate − all-play win rate (ties ½) | 0.30 of win rate | 4 games |
| Opponent scoring | 0.20 | (league avg − opponents' avg) ÷ league avg | 12% | 4 games |
| Close games | 0.15 | win rate in games decided by < 5 pts (ties excluded) − 0.5 | 0.5 | 4 close games |
| Schedule strength | 0.15 | league-average all-play rate − mean all-play rate of opponents drawn | 0.10 | 4 games |
| Postseason draw | 0.10 | mean of (opponent season PPG − score vs you) ÷ season PPG, championship bracket | 12% | 2 bracket games |

Unavailable components are dropped and the remaining weights renormalised to sum to 1.
Score = round(clamp(50 + 50 × Σ wᵢ·devᵢ, 0, 100)); null under 4 regular-season games. Season and career use
the same code on different spans; the all-play rate is pooled over the span (one rate × games), not summed per week.

Confirmed from the code:
- **Item 2 (tiny sample cancels a huge one): confirmed.** Postseason draw saturates at 12%; Jones's three bracket
  games (16% above) hit −1 × 0.10, while his +10.2-win surplus is only (+0.076 rate ÷ 0.30) × 0.40 ≈ +0.10.
- **Item 3 (different effective scales): confirmed.** The wins component is rate-based, so +2.1 wins in 9 games
  (+0.23 rate → 0.78) outweighs +10.2 in 135 (+0.076 → 0.25).
- **Item 4 (schedule strength artifact): confirmed.** The league average all-play is ~0.500 by construction while
  a manager's opponents exclude himself, so the best all-play manager's opponents are weaker by construction.
- **Item 5 (one all-time average): confirmed.** The league average is the mean of each manager's career PPG
  across the whole span, and includes the manager's own scores.
- **Item 8 (bios quote career as this season's): confirmed.** The bio facts carried one `luckScore` (career) and
  the prompt asked how "this season is going".

### Live-site numbers vs recomputation
- 2026: McManus +0.7, Jones +2.1, Shea −2.8: exact.
- Career: Jones +10.2 (exact); Javier −8.6 (page −8.1), McManus +2.4 (page +2.9). The page's "expected from scoring
  alone" multiplied a pooled career all-play rate by games; the new figure sums each week's own expected value with
  that week's real team count (2017 had 8). Σ over the league is 0.000 either way only for the new method.

## Phase 1: luck (done)

- `src/server/stats/luck-wins.ts`: luckWins = actual − expected; expected per week = (out-scored + ½ tied) ÷
  (teams − 1) over completed regular-season weeks; z = luckWins ÷ √Σp(1−p); labels |z| < 0.5 Neutral, 0.5–1
  Slightly, 1–2 Lucky/Unlucky, > 2 Extremely; under 6 games "Not enough games".
- Context rows (not blended): opponent scoring vs the same week's field excluding the manager; close-game record;
  playoff draw with game count. Schedule strength dropped.
- One definition on: standings "Luck" column, managers table and cards, profile header and context panel, power
  rankings chip, AI bios (separate `thisSeasonLuck` / `careerLuck` facts). The 0–100 composite is gone from the UI.
- Text validator: a sentence about "this season" that quotes a career-only figure is rejected.
- Scouting reports use the profile's career record (the old one excluded the season in progress).
- `npm run verify:data` checks Σ luck = 0 and Σ expected = games for every season and career (all pass).

## Phase 2: data correctness (done)

| # | Item | Status | What changed |
|---|------|--------|--------------|
| 1 | PR heatmap headers shifted | Real, fixed | `components/power/power-grid.tsx`: header and rows share one column list; the movement header is a real grid cell (the old `sr-only` cell was absolutely positioned and left the grid). Test: header count = row cell count. |
| 2 | Duplicate factors | Real (all-play = expected wins; starter strength = unweighted PPG) | Formula unchanged. Overlap stated under "How the score is built". Proposed merged weights in the final report. |
| 3 | Projected closeness used the final score | Real, fixed | Selection uses only pre-kickoff inputs (frozen projections, entering records/standings, last week's PR snapshot, series before the week), is stored in `featured_selections` once per week by the pipeline, and is never recomputed. Week 9 now reads "12.0 points between them on projections" (was 19.6). |
| 4 | "— vs —" in copy | Real, fixed | Projection tokens only exist when both projections do; the validator rejects "— vs —" and "(—)". |
| 5 | "Live" isn't live | Real, fixed (live option) | `server/live-scores.ts`: Sleeper matchups, cached 10 min, stamped "as of h:mm CT", never stored. Without a live score the badge says "In progress". Home ISR is 10 min. |
| 6 | Playoff weeks show placeholder pairings | Real (weeks 15–17 hold Sleeper placeholders) | Until every regular-season week is final, a playoff week shows "Bracket set after Week 14" and projected seeds; placeholder matchup pages redirect to the week. Uses Sleeper's `playoff_week_start` (Season.playoffStartWeek). Note: the live sync never sets `bracketType`, so "regular season final" is the signal. |
| 7 | Players to watch | Real, fixed | Latest stored roster up to the week (not the draft-day squad) and this season's PPG once 3+ games; last season's rate only fills gaps and is labelled. |
| 8 | Sync stamp differs by page | Real, fixed | Every cached loader also carries one shared `site-data` tag. The revalidate step clears caches in its own request, then visits every stamped route and checks `data-synced-at` agrees (up to 3 passes), reporting PARTIAL with the routes that disagree. |
| 9 | Scouting record | Real, fixed in Phase 1 | Scouting facts use the profile's career row. |
| 10 | Raw points across positions | Real, fixed | `stats/position-value.ts` reuses the Tribunal's `buildPositionContext`. Draft steal/bust, the revisited grade's ranking and best pickups now use points above replacement; replacement levels are printed under each. |
| 11 | Bench Blunder | Not real | It was already optimal − actual; the wording now says so. |
| 12 | Playoff odds | Real, fixed | Per-team sd shrunk toward the pooled sd (10-game prior), mean regressed (4-game prior) and redrawn per simulated season; ">99%"/"<1%" unless clinched/eliminated. |
| 13 | Record Watch | Real, fixed | Only paces that would break the record, sorted by pace. |
| 14 | Finish distribution | Real, fixed | Footnote: 2017 had 8 teams. |

## Phase 3: charts and design (done)

**Charts added or replaced**
- Luck ledger (`/standings`, season; `/managers`, career): diverging bars from 0, sorted, signed labels. Replaces actual-vs-expected bars.
- Weekly score vs league average (profile, season picker for Sleeper years): filled bars = wins, outlined = losses.
- Scoring range (`/power-rankings`): a dot per week, a median tick, sorted by median. Replaces "Power score vs win %".
- Playoff odds by week (`/standings`, in season): stored per week in `PlayoffOddsSnapshot` (additive migration), Weeks 1–9 of 2026 backfilled by the compute step; the latest week matches the table exactly. Top 6 bright, tap a team to follow it, direct end labels with collision handling.
- Points left on the bench (`/power-rankings`): best legal lineup minus the started lineup, season total, per-game value in the tooltip/table.

**Chart fixes**: rank by week uses direct end labels and tap/hover highlight; PF/PA scatter has round ticks, surname labels, label collision handling and one accent; week strip has surname labels, a week-average line, no jitter, hollow losses; game flow is accent vs neutral; rivalry margins coloured by winner, bracket games outlined, season ticks only; no mid-word truncation in chart text. Every chart's data table is now a visible "Show the numbers" disclosure (tap equivalent of every tooltip).

Colour note: the spec's win/loss pair (#34C77B / #F0605D) fails a deuteranopia check (ΔE 5.8), so every use carries a second cue (direction from zero + signed label, or filled vs outlined).

**Design**: tokens (#0B0F14 page, #121821 surface, #18202B raised, #243040 border, #E8EDF2 text, #93A1B2 muted, sky-blue accent), `color-scheme: dark`, type scale 12/14/16/20/28/40 (replaces the earlier +20% scale), card radius 12, one 1200px page width, nav Standings · Matchups · Power Rankings · Managers · History · More (Home in the mobile menu), compact page header with the photo only in the header band, shared `DataTable` (sticky first columns, mono right-aligned numbers, 44px rows, sortable headers with visible state) used by standings with "More columns", History index first with retrospectives collapsed, Rivalries "Show all", profile tabs (Overview / Seasons / Head-to-head / Story), Tribunal verdict list with expandable detail, methodology collapsed at the bottom, matchups awards paragraph removed, 44px week/season pills, visible focus rings, rivalry slug URLs (`/rivalries/gavin-detillier-vs-anthony-cibilich`) with permanent redirects from ids and reversed order.

**Checks**: build, lint, typecheck, 467 tests. Browser at 390 and 1440 on 13 routes: all 200, no horizontal overflow, no console errors. Lighthouse accessibility: standings, power rankings, profile, matchups, history, rivalries, transactions, drafts 100; home, Tribunal 96 and managers 95 before the last contrast fixes.

Heights at 390px (before → after): History 9,400 → 4,667; Rivalries 9,000 → 5,422; Trade Tribunal 7,100 → 2,455; profile 7,100 → 3,985.

Also fixed while checking: the Matchups hub listed the whole season's moves as "this week" for a week with none (Week 15 showed 148).

## Phase 4: domain and search (done)

- One site URL: `NEXT_PUBLIC_SITE_URL` (default `https://www.rattrapfantasy.com`, `src/lib/site-url.ts`) feeds `metadataBase`, canonicals, sitemap, Open Graph, JSON-LD and the pipeline's post-run check. The audit script's default URL now points at www.
- Old alias `fantasy-football-project-jade.vercel.app/*` → 308 → `https://www.rattrapfantasy.com/*`, query kept (`next.config.ts`, host-matched).
- Indexing allowlist (`src/lib/indexing.ts`): `/`, `/about`, `/standings`, `/power-rankings`, `/history`, `/records`, `/championship-belt` are indexable on www without a query string; everything else is `noindex, follow`; every other host is `noindex, nofollow`. The proxy sends `X-Robots-Tag` and a canonical `Link` header on every page; allowlisted pages also carry `index, follow` and `<link rel="canonical">` in HTML. The global `X-Robots-Tag` header and global noindex meta are gone.
- `robots.txt`: allow all; disallow `/admin`, `/api/`, `/login`; sitemap line. `sitemap.xml`: the seven allowlisted www URLs, `lastModified` = last successful sync. Web manifest added.
- Titles: home "The Rat Trap Fantasy Football League | Rat Trap Fantasy", template "%s | Rat Trap Fantasy Football", unique descriptions on indexable pages, `og:url`, `og:site_name`.
- WebSite JSON-LD on the homepage (name, alternateName, url only).
- `/about`: static ~150-word page, linked from the footer.
- Optional `GOOGLE_SITE_VERIFICATION` env var renders the Search Console meta tag.

**Auth audit (anonymous requests, checked locally against the production build)**

| Route | Server-side guard | Anonymous result |
|---|---|---|
| `/admin`, `/admin/*` (12 pages) | proxy + `requireAdmin` in every page | 307 → `/login?callbackUrl=…` |
| Admin server actions (10 files, 28 actions) | role check in every action | rejected |
| `/chat-lore` | proxy; redirects into `/admin` | 307 → login |
| `/championship-belt/edit` + its action | proxy + page check + action check | 307 → login |
| `/predictions/submit`, predictions action | session required | sign-in prompt / rejected |
| `/api/cron/[job]` | `Authorization: Bearer CRON_SECRET` | 401 (503 where the secret isn't configured) |
| `/api/auth/*` | NextAuth | public by design |
| `/api/health` | none | public; job names and text counts only |
| `/login` | none | public, `noindex` |

## Final audit pass (Nov 15, 2026)

| Defect found | Fix | Test |
|---|---|---|
| Jones and Javier both +2.1 luck wins (2026); standings called Jones the luckiest while Javier's profile said "luckiest" | Luck ranks are competition ranks at the shown precision; ties read "tied-luckiest", and the standings name both | `luck-wins.test.ts` (rankLuckWins) |
| The old 0–100 Luck Score still fed the manager-summary AI packet (and was computed on every profile render) | Packet uses luck in wins; `stats/luck.ts` and its repository functions removed | typecheck |
| Power rankings counted a tied weekly score as zero expected wins (luck-wins counts half) | Ties count half in both | `weekly-power-rankings.test.ts` |
| Power-ranking explanations: Starter strength described as a different measure (it is unweighted PPG); Expected wins as separate from All-play (they move together); Opponent PPG as "a hard slate is not held against a team" (it is a bonus for high-scoring opponents) | Descriptions say what each factor is; weights unchanged | — |
| Matchup of the Week said "Preview" with no score while its game was being played | Follows its own card: Live + points + "as of", or In progress | — |
| Open pages never refreshed during games | `LiveRefresh`: router.refresh every 5 min while the week is in progress and the tab is visible (cached page; no Sleeper calls of its own; no text generation) | `live-refresh.test.tsx` |
| `/managers/<unknown>` and `/matchups/<season>/<week>/<unknown>` answered 200 (loading.tsx streamed before notFound); legacy id URLs redirected via meta refresh | Index loading states moved into `(index)` route groups; detail pages now 404 / 308 properly | checked on the build |
| Manager links used database ids in 18 places | `managerPath(name)` everywhere | — |
| Commissioner swap read "Shea was awarded Strange and Smith-Njigba, dropping Strange and Smith-Njigba" | Moves touching two rosters say who received what | `transaction-describe.test.ts` |
| The `*.vercel.app` alias redirect also caught `/api/*`, so a cron or webhook sent to the alias got a 308 | `/api/` excluded from that redirect | — |
| Draft board caption described hindsight numbers in the position view; history narrative called the top scorer who missed the playoffs "the season's unluckiest team" | Caption follows the view; claim removed | — |

Luck was re-derived independently from raw `MatchupTeam` rows (pairwise per week, ties half, regular season only, both sides verified): all 10 managers match the site to 1e-15 for career and 2026; every season sums to 0. Pipeline lock checked with two concurrent runs (second SKIPPED); row counts unchanged apart from one new Sleeper transaction.
