# Weekly automation

How the site keeps itself up to date once the season starts.

## The job

One function, `runWeeklyRefresh()` in `src/server/jobs/weekly-refresh.ts`. Both
entry points call it, so a scheduled run and a manual run cannot diverge:

| Entry point | Path | Who |
| --- | --- | --- |
| Vercel Cron | `GET /api/cron/weekly` | scheduled |
| Admin button | `/admin/refresh` | a signed-in admin |

## Order of operations

The order is fixed, and it is the point of the job.

1. **SYNC** — pull platform data from Sleeper: matchups, scores, rosters,
   player-level scoring, transactions, the draft, playoff results.
2. **RECALC** — recompute the deterministic statistics that read that data.
   Weekly awards are stored; standings, records, rivalry statistics, Luck
   Scores and Power Rankings are derived on read from the synced scores and are
   correct the moment the sync lands.
3. **WRITE** — only now generate AI copy (weekly recaps and previews), so the
   writer is working from data that has just been verified rather than from
   whatever happened to be in the database.
4. **PUBLISH** — invalidate the cached read paths (`src/server/cache.ts`) so the
   next request serves the new numbers.

Generating before syncing is the failure this ordering exists to prevent: a
recap written from last week's scores is worse than no recap.

## Schedule

`vercel.json`:

```json
{ "path": "/api/cron/weekly", "schedule": "0 12 * * 2" }
```

Every **Tuesday at 12:00 UTC** — about 07:00 US Central. That is after Monday
Night Football has finished and after Sleeper has settled the week's scoring.
Running earlier risks recapping a week that is not final.

## Season awareness

The job reads the season phase *after* the sync, so a draft that completed since
the last run is noticed on this run rather than the next one.

| Phase | What runs |
| --- | --- |
| `PRESEASON` (no draft yet) | Sync only. Nothing roster-dependent: no awards, no previews, no recaps. The sync is how the draft gets noticed. |
| `POST_DRAFT` (draft done, no week played) | Sync and cache refresh. Rosters exist, so the Power Rankings switch from Manager Baseline to Preseason on the next read. There is still nothing to recap. |
| `IN_SEASON` | Everything. |

**After the draft**, run the job once by hand from `/admin/refresh` rather than
waiting for Tuesday — that is the initial post-draft refresh, and it is what
turns "Manager Baseline Rankings" into "Preseason Power Rankings".

## Idempotence and resumability

Every step is safe to run twice and cheap to re-run when its work is already
done. A run that fails partway is resumed by running it again.

- **Transactions** upsert on `(seasonId, sleeperTransactionId)`. There is no
  path that creates a second row for the same Sleeper transaction.
- **Matchups** are replaced per week. The human `verifiedScore` judgement — the
  flag that excludes an abandoned team's zeros from the record books — is read
  before the replacement and reapplied after it, so the cron cannot quietly
  re-admit scores an admin excluded.
- **Weekly awards** upsert on `(seasonId, week, type)`.
- **AI previews and recaps** are skipped when one already exists for that
  matchup, so no article is ever written twice.
- **A step that throws** is recorded and the job continues. A Sleeper outage
  should not stop the awards being recomputed from data already on disk. The
  response reports exactly what ran, what was skipped and what failed.

The cron endpoint returns **200** on a clean run and **207** on a partial one —
never 500 for a partial, because a 500 makes Vercel retry the whole job when
most of it succeeded.

## Environment variables

Set under Vercel → Settings → Environment Variables. No value is ever written to
a response, an audit-log row, or an error message: every message passes through
`safeError()`, which redacts known secrets and strips URL userinfo.

| Variable | Required | Effect if missing |
| --- | --- | --- |
| `DATABASE_URL` | yes | Nothing works. |
| `SLEEPER_LEAGUE_ID` | no | The sync step is **skipped**, not failed. |
| `OPENAI_API_KEY` | no | The writing step is **skipped**. Placeholder copy is never saved, so pages keep their honest empty states. |
| `CRON_SECRET` | recommended | Without it `/api/cron/weekly` is open to anyone who guesses the path. When set, the endpoint requires `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sends automatically. |

## Audit trail

Each run writes one `DataSyncLog` row (`syncType = STATS_RECALC`) recording
status, how many steps succeeded, who triggered it, and a redacted failure
summary. `/admin/refresh` lists the last ten.

## Content that is NOT on this schedule

These are deliberately manual, because they are expensive and rarely change:

| What | Script |
| --- | --- |
| Power-ranking, rivalry and trade blurbs | `scripts/ai/backfill-blurbs.ts` |
| Season retrospectives | `scripts/ai/generate-season-articles.ts` |
| Manager profiles | `scripts/ai/regenerate-manager-profiles.ts` |
| Draft grades | `scripts/ai/regenerate-draft-grades.ts` |
| Rivalry statistics | `scripts/import/import-rivalries.ts` |
