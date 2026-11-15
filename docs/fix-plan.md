# Fix plan: data integrity, freshness, charts

Working plan for `rat-trap-fix-prompt.md` (review of Nov 14, 2026, Week 9 complete).
Branch: `fix/data-integrity-and-freshness`, one commit per phase.

## 1. The stack as it is today

| Area | What's there |
|---|---|
| Framework | Next.js 16.3.8 (App Router, Turbopack build), React 19, Tailwind 4, shadcn/base-ui, **Recharts 3** (already a dependency, so it's the chart library) |
| DB / ORM | Postgres on Supabase (pooler), Prisma 7 with `@prisma/adapter-pg`. Schema in `prisma/schema.prisma`, migrations applied with `prisma migrate deploy` (the Vercel build only runs `prisma generate`). Local `.env.local` points at the **production** database; there is no separate dev DB. |
| Sleeper sync | `src/server/sleeper/sync-service.ts` (`syncCurrentLeague`): league, users, rosters, matchups per week (only FINAL weeks keep scores; `deriveWeekStatus` in `src/lib/nfl-schedule.ts`), player scores, transactions, draft, brackets. Upserts keyed on Sleeper ids. |
| ESPN archive | 2017–2022 imported once by `scripts/import/*`; static. Never re-scraped. |
| Which games count | `src/server/repositories/verified-games.ts`: both sides `verifiedScore`. Head-to-head excludes consolation-bracket games. |
| Scheduled job | Vercel Cron `0 12 * * 2` → `GET /api/cron/weekly` → `runWeeklyRefresh()` (`src/server/jobs/weekly-refresh.ts`): SYNC → VERIFY → RECALC (awards, rivalry stats) → WRITE (recaps/previews, trade verdicts, power-ranking blurbs) → PUBLISH (`revalidateTag` ×3). Logged as one `DataSyncLog` row (`STATS_RECALC`). Last success: 2026-11-10 12:00 UTC. Bearer `CRON_SECRET`, fail-closed. |
| AI provider | OpenAI Chat Completions via `fetch` (`src/server/ai/openai-provider.ts`), default `gpt-5-mini` (`OPENAI_MODEL`), `gpt-5` for synthesis; xAI switchable (`AI_PROVIDER`). Voice rules in `src/server/ai/voice.ts` / `VOICE-GUIDE.md`. |
| Where AI text lives | `AIBlurbCache` (power-ranking, rivalry, trade verdict, featured preview/recap, keyed by `inputHash`, **shown even when stale**); `Rivalry.summary`; `ManagerPerformanceSummary` (bios); scouting reports; `DraftGrade` commentary; `AIContentGeneration` (per-matchup previews/recaps); `Article` (season retrospectives). Most are written by hand-run scripts in `scripts/ai/*` and never refreshed. |
| How pages get data | Server components call repositories in `src/server/repositories/*`; aggregates are wrapped in `unstable_cache` (`src/server/cache.ts`, 1-hour TTL, tags `league-data` / `manager-data` / `generated-content`). |
| Rendering | **Every route is dynamic**: the root layout calls `auth()` (cookies), and several pages read `searchParams`. `loading.tsx` skeletons flash on every navigation. No ISR. |

## 2. Issue verification

Checked against a production build of `main` (3f19c19) running locally against the
production database, page text dumps and screenshots at 1440px and 390px, plus
direct queries. The reviewed URL (`fantasy-football-project-9wdmgouht…`) is an
immutable deployment URL behind Vercel SSO; several symptoms match bugs that the
Oct 4 commits on `main` already fixed, so that deployment appears to be older than
`main`. Everything below is what the **current code** does.

### Confirmed (fixing)

| # | Issue | Evidence / root cause |
|---|---|---|
| 1a | H2H disagrees across pages | `/matchups` card: "5-8 to Anthony Cibilich over 13 meetings"; "Why this game": 14; matchup detail: "Cibilich leads the series 8-6". The card drops the current week's game even when it's final, "Why this game" keeps it, and the phrasing is wrong. Four separate H2H implementations (`rivalry-recompute`, `featured-matchup-repository` ×2, `manager-repository`). The stored rivalry rows match a recompute (B–C 6-8/14, Schwing–C 7-11/18). |
| 1a | AI preview series wrong | Week 9 preview says "leading the all-time series 9-5" (actual 8-6 going in). AI text, see Phase 3. |
| 1b | Rank / cut line | Ranks print in the current code (in-progress order = wins, then PF, which is Sleeper's default; the league has no custom tiebreak). No playoff cut line anywhere. Ranking logic is inline and untested. |
| 1c | Current week | Today (Sat Nov 14) Sleeper says week 10 is in progress (`leg` 10, `last_scored_leg` 9). Home labels Week 10 "Upcoming" and counts down to Week 11; the DB only learns about week status on Tuesdays. Three different "current week" derivations (`season-phase.ts`, `homepage-repository.ts`, `nfl-calendar.ts`). |
| 1d | Unfinished season | Records already use completed seasons only. Hall of Shame hides 2026 entirely; no "Current" row and no record-watch line. The tiebreak tag logic is checked and tested. |
| 1e | Draft "Strongest" | Four teams show "Risk concentration", a dropped factor. |
| 1e | Draft revisited for 2026 | Says it's written "once the 2026 season ends"; nothing is computed in-season for Sleeper seasons. |
| 1e | Luck labels | Every career score (37–58) is "Slightly …" except an exact 50. |
| 1e | Transaction churn | McManus's Kendre Miller ↔ Austin Ekeler swaps show as 6 rows in Week 9. |
| 1e | Form chips | Unlabelled, 3 on the card vs 5 in standings, no tooltip. |
| 3 | AI text contradicts boxes | Rivalries: B–Shea box 8-11, text "12 wins to 7 … four-game streak" (box ×5); Schwing–McManus 9-18 vs "16-10"; Detillier–Cibilich 13-9 vs "13-7 across 20". Cibilich bio "62-64", "Luck Score sits at 48" (table 68-67, 50). Shea bio "six Finals trips and three Finals appearances". Power-ranking blurbs: Lisan al Gibb "top mark in consistency", "86.7% of optimal", "lifting them from 9th". Recaps call any 7–30-pt margin "chalk" (`framing()` in `weekly-pipeline.ts` ignores who was favored). |
| 2 | Staleness | One weekly cron; nothing daily; no lock; text that's stale is still shown; no health endpoint; no staleness banner. |
| 4/5 | Charts and polish | As listed in the prompt; all real. |

### Not reproduced on current `main` (already fixed Oct 4; the live deployment is older)

- Matchup detail "Barkemeyer leads the series 6-9" (leader backwards): now "Cibilich leads the series 8-6".
- Manager profile "15 meetings, Cibilich 9-6" vs Barkemeyer, Schwing–Cibilich "13-8 over 21": the profile now shows 8-6/14 and 11-7/18 (consolation excluded). **The bio prose still says 13-8** (Phase 3).
- `#` column "—" on `/standings` and `/matchups`; "0th in the table": positions now print.
- Homepage Week 17 "Upcoming": Home now shows the last final week plus next week (still wrong while a week is live, see 1c).
- "Best season record 8-1 McManus 2026" / "Worst 0-9 Shea 2026" / Hall of Shame "Worst season ever 0-9": completed seasons only.
- Bio truncation at decimals ("averaging 105."): `excerpt.ts` masks decimals; extended with thousands separators and a test.
- Draft Cards "ESPN does not expose" for 2026: the message is already era-dependent.
- "There are currently no `og:` tags": `opengraph-image` routes exist for home, matchup, manager, rivalry, season, news, power rankings and trades.
- Homepage "DRAFT IS HERE … Sat, Sep 5, 2026": not shown in-season; the hero becomes phase-driven anyway (Phase 2).

## 3. Decisions (made autonomously; the owner asked for no approval stops)

| Question | Decision | Why |
|---|---|---|
| H2H definition | Regular season + championship bracket (+ any postseason game with no bracket on record); consolation/toilet bowl excluded; every **final** game counts, including the current week once it's final. Playoff record shown separately. | Already the site's documented rule; applied everywhere through one function. |
| Standings order | Win % → points for → points against → name | Sleeper default (no custom tiebreak in league settings). |
| Luck labels | One scale: ≥75 Extremely Lucky · 62–74 Lucky · 55–61 Slightly Lucky · 46–54 Neutral · 39–45 Slightly Unlucky · 26–38 Unlucky · ≤25 Extremely Unlucky | Labels only; the score formula is unchanged. Gives careers (37–58) three distinct labels and seasons (11–89) the full range. |
| Scheduler | Vercel Cron, three jobs, each at most once a day (works on Hobby and Pro); each run is split into resumable, idempotent steps with a time budget, and text generation continues on the next invocation. | Plan tier couldn't be checked from here (no Vercel CLI). The current cron already runs with `maxDuration = 300`. 15-minute live scoring needs Pro or a GitHub Actions schedule: documented, not built. |
| Alerts | Webhook (Discord/Slack-compatible JSON) on a failed run, only when `ALERT_WEBHOOK_URL` is set. | No paid service; inert until configured. |
| Database | Additive migrations only (new tables and nullable columns), applied to production. New AI text goes into a new `GeneratedText` table that the old deployment doesn't read. | The live site can't show half-migrated text while the branch is undeployed. |
| ISR | Header session moved client-side so the layout stops forcing dynamic rendering; data pages get `revalidate` plus on-demand `revalidateTag`/`revalidatePath` from the pipeline. | Without this, `export const revalidate` is inert. |
| FAAB | Not shown: the league uses rolling waivers (`waiver_type` 0) and nobody has spent budget. | Prompt: "if the league uses FAAB". |
| ADP | Stays excluded: no free, reliable historical ADP source for this league's format. The explanation is kept accurate. | Prompt allows either. |

## 4. Approach per phase

**Phase 1.** `src/server/stats/head-to-head.ts` gains `seriesBetween()` and `describeSeries()`, the only H2H math and phrasing on the site; one repository loader (`getHeadToHeadIndex`) feeds the rivalry recompute, profile, matchup detail, featured card, "Why this game" and AI facts. A cross-path test runs the same fixture through all three builders. `src/server/stats/standings.ts` (`rankStandings`, tiebreaks, cut line). `src/server/league-clock.ts` (`resolveLeagueClock`, pure, tested) replaces the three week derivations. Record watch and a "Current" last-place row. Draft revisited grade computed for Sleeper seasons; dropped factors never "strongest". Luck bands. Transaction churn collapse. Labelled form chips with tooltips.

**Phase 2.** `PipelineRun` and `PipelineLock` tables; `src/server/pipeline/*` with steps `sync → compute → generate-text → revalidate`; jobs `daily` (10:00 UTC), `weekly` (Tue 13:00), `thursday` (Thu 13:00); routes `/api/cron/[job]`; `npm run pipeline -- --job weekly [--week 9]`; `/api/health`; staleness banner; phase-driven home hero; ISR.

**Phase 3.** `GeneratedText` (kind, subject, template with `{{tokens}}`, facts, inputHash, asOfSeason/Week, model, status). Facts builders reuse the page repositories; the model sees only facts; numbers are tokenised and filled on render; a validator checks every literal number and W-L in the output against the facts (2 retries, then a templated fallback); a hash mismatch renders the fallback; the chip reads "AI-generated · as of Week n".

**Phase 4/5.** In the prompt's page order, one chart library (Recharts), one team palette, standard position colours.

## 5. Outcome (Nov 15, 2026)

Deployed to production from `main` (fast-forward of `fix/data-integrity-and-freshness`).
Additive migrations applied: `PipelineRun`, `PipelineLock`, `PowerRankingSnapshot`, `GeneratedText`.

- Checks: `typecheck` clean, `lint` clean, 425 unit tests pass, production build passes both with the
  database and without it (see the build guard below). Every page crawled at 1440px and 390px: all 200,
  no page errors, no sideways page scroll.
- Data: `verify:data` 0 mismatches; head-to-head identical across rivalry/profile/matchup paths for all 45 pairs.
- Text: full pipeline run → 212 AI texts, 0 stale, 0 on fallback (`docs/health-after-pipeline.json`).
- Screenshots: `docs/screenshots/before` (current `main` before this work) and `docs/screenshots/after`.

**Build guard.** Pre-rendered pages query the database during `next build`. The first Vercel Preview build failed
because that environment has no `DATABASE_URL`. `src/server/build-guard.ts` makes a build that can't reach the
database render those pages per request instead of failing; Production pre-renders as designed.

**Methodology notes.** No power-ranking, Luck Score, draft-grade or Trade Tribunal formula changed. Changed labels/
definitions: Luck Score label bands (46–54 Neutral); "Schedule strength" relabelled "Opponent PPG"; the Hall of
Shame bench record now counts verified head-to-head weeks only (71.6, Javier Wk 14 2024 — the old 79.5 was an
eliminated team's opponent-less Week 17); Draft Cards "Strongest" skips factors that didn't grade the team.

**Not built.** Live scoring every ~15 minutes (needs Vercel Pro or a GitHub Actions schedule; documented in
`docs/WEEKLY_AUTOMATION.md`). True win probability (the game-flow chart uses final scores by NFL window).
