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
