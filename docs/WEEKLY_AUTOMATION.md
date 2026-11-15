# Automation: the data pipeline

How the site keeps itself current. Everything (numbers and AI text) is
refreshed by one pipeline, `runPipeline()` in `src/server/pipeline/run.ts`:

```
sync -> compute -> generate-text -> revalidate
```

The same code runs from Vercel Cron, the admin button (`/admin/refresh`) and
the command line (`npm run pipeline`), so a manual run can't differ from a
scheduled one.

## Schedule (Vercel Cron, `vercel.json`)

All times UTC. The league is in US Central (UTC-6 in winter, -5 in summer).

| Job | Cron | When | What it does |
|---|---|---|---|
| `daily` | `0 10 * * *` | every day, ~4-5 AM Central | Sleeper sync (rosters, transactions, scores, state), projections for the coming week until kickoff, recompute, rewrite any text whose facts changed (a catch-up net, usually nothing), refresh caches |
| `weekly` | `0 13 * * 2` | Tuesday, after MNF is final | The completed week: recaps, power-ranking blurbs, awards copy, the weekly news issue, rivalry write-ups for pairs that met, bios/scouting whose numbers moved, draft revisit, open trade verdicts, snapshots |
| `thursday` | `0 13 * * 4` | Thursday, after Wednesday waivers | Stat-correction pass (last week's scores are fingerprinted before and after the sync; a change regenerates exactly the texts that depended on them) and previews for the upcoming week from the post-waiver projections |

Each is `GET /api/cron/<job>` with `Authorization: Bearer <CRON_SECRET>`, which
Vercel Cron sends automatically. A production build with no `CRON_SECRET`
refuses (503) rather than running open.

**Plan limits.** Three crons, each at most once a day, fits the Hobby plan as
well as Pro. Each run is budgeted to finish inside the 300-second function
limit: sync and compute take ~30-60 s; text generation runs until ~25 s before
the limit and leaves anything unfinished for the next run (its templated
fallback shows meanwhile, never stale prose). The first full generation (212
texts) was done from the CLI, which has no time limit.

**Live scoring (not built).** A 15-minute cron during game windows needs Vercel
Pro (Hobby crons run at most daily). The alternative is a GitHub Actions
`schedule:` workflow calling `/api/cron/daily` with the secret. The game-flow
chart on matchup pages is built from final player scores and the NFL schedule;
true win probability would come from that live feed.

## Steps

1. **sync**: `syncCurrentLeague()` (Sleeper), then projections for the
   current week (team totals are rewritten until kickoff, then frozen), player
   projections for any final week missing them, and reconciliation against
   Sleeper (`verifySeasonData`). Thursday's run compares last week's scores
   before and after.
2. **compute**: weekly awards, rivalry statistics, the cross-page
   head-to-head consistency check (fails the step if any pair disagrees), and
   power-ranking snapshots (one row per team per week; weeks before snapshots
   existed are backfilled by recomputing the model).
3. **generate-text**: builds the catalog of every AI text that should exist
   (`src/server/text/catalog.ts`), compares each one's facts hash with the
   stored text, and writes only what changed. See "AI text" below.
4. **revalidate**: drops every data-cache tag and revalidates every
   pre-rendered page (`revalidatePath("/", "layout")`). From the CLI it calls
   the live site's `/api/cron/revalidate` when `SITE_URL` and `CRON_SECRET` are
   set; otherwise the hour-long ISR window picks the change up.

Every step is idempotent. A `PipelineLock` lease (10 minutes) stops runs
overlapping; a run that dies releases it when the lease expires. Each run writes
a `PipelineRun` row: job, trigger, status, step reached, per-step results,
counts and redacted errors.

## AI text (facts-first)

Every AI text is a `GeneratedText` row written from a `facts` object built by
the same loaders that render the page. The model writes prose with `{{tokens}}`
for key stats (filled from current facts when the page renders); a validator
rejects any literal number, ordinal, W-L or counted number-word that isn't in
the facts; two retries, then a templated fallback. A page shows the text only
while its `inputHash` matches the facts it would build now; otherwise it shows
the fallback, labelled "From the stats". The chip on AI text reads
"AI-generated · as of Week n".

| Text | Refreshed when |
|---|---|
| Matchup recaps | the week is final (Tuesday) or a stat correction changes the score |
| Matchup previews | from Thursday 13:00 UTC; frozen at kickoff with the projections |
| Power-ranking blurbs | the rankings move (Tuesday) |
| Weekly awards copy, news issue | the week is final (Tuesday) |
| Rivalry write-ups | the pair meets |
| Manager bios, scouting reports | the manager's numbers move |
| Draft revisit (Sleeper season in progress) | weekly |
| Trade verdicts | while the valuation can still move |
| Season retrospective | once, when the season completes |

## Monitoring

- `GET /api/health`: last successful sync, last run and last successful run,
  whether a run holds the lock, season/phase/weeks from the league clock, and
  `texts: { total, stale, fallback, byKind }`. 200 when healthy, 503 when data
  is stale, any text is out of date, or the last run failed.
- Site-wide banner "Data last updated {date}." when, during the season, the
  last successful sync is more than 8 days old.
- Optional failure alert: a Discord/Slack-compatible webhook POST on a failed
  or partial run when `ALERT_WEBHOOK_URL` is set.
- `npm run verify:data` (scores and records vs Sleeper, plus head-to-head
  consistency) and `npm run verify:texts` (exit 1 if any text is out of date).

## Running it by hand

```
npm run pipeline                          # weekly rebuild, all steps
npm run pipeline -- --job daily           # daily | weekly | thursday | manual
npm run pipeline -- --week 9              # backfill / redo a specific week
npm run pipeline -- --steps compute,generate-text
npm run pipeline -- --force-text          # rewrite text even if facts are unchanged
npm run pipeline -- --no-model            # templated text only, no AI calls
npm run pipeline -- --steps sync --backfill-projections 100
npm run cron:trigger -- --job daily       # hit a running local server like Vercel Cron does
```

**Backfilling a past week:** `npm run pipeline -- --job manual --week 7`
recomputes awards, rewrites that week's power-ranking snapshot and regenerates
any text whose facts changed. Matchup recaps and previews exist for every final
week of the current season, so a corrected Week 7 score regenerates exactly the
Week 7 texts that quote it.

## Environment variables (Vercel → Settings → Environment Variables)

Names only, never values.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | already set |
| `DIRECT_URL` | for migrations | already set |
| `AUTH_SECRET` | yes | already set |
| `CRON_SECRET` | yes | already set (the existing cron has been succeeding) |
| `SLEEPER_LEAGUE_ID` | yes | already set |
| `OPENAI_API_KEY` | for AI text | already set; without it every text uses its templated fallback |
| `ALERT_WEBHOOK_URL` | optional, new | Discord/Slack incoming webhook for failure alerts |
| `SITE_URL` | optional, new | only for CLI runs that should clear the live site's caches |

## Migrations

Additive only (new tables): `PipelineRun`, `PipelineLock`,
`PowerRankingSnapshot`, `GeneratedText`. Applied to production with
`npx prisma migrate deploy` before the deploy that uses them. The Vercel build
runs `prisma generate` only, not migrations.
