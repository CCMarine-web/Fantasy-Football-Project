# Source Data Manifest

Raw sources were delivered via WeTransfer (`~/Downloads/wetransfer_fantasy-football_2026-07-19_2334`).
**None of the raw source files are committed to git** — they live outside the repo and,
where copied in, under the git-ignored `private/` directory. See `.gitignore`.

| # | Source | Type | Use | Privacy |
|---|--------|------|-----|---------|
| 1 | Fantasy Football Managers Profile Picture | 10 JPEGs (filename = full name) | Manager `photoUrl`; optimized → `public/managers/*.webp`; imported as `MediaAsset(PROFILE)` | Public-ish (league members); 2 flagged for review |
| 2 | Fantasy League Pictures | 8 JPEGs (team/event photos) | `MediaAsset` records, category **UNCERTAIN** (all show identifiable people) — admin review before any public display | Admin review |
| 3 | League History Details | 9 JPEGs (2015–2023, typed commissioner recaps) | Transcribed → `LeagueHistorySection` rows; improves public History page. Narrative never overrides verified Sleeper stats | Public (commissioner-authored) |
| 4 | Managers Names.xlsx | Excel (Name → Current Team Name) | Identity resolution: maps real names + current team names to existing Sleeper managers; seeds `ManagerAlias` | Internal |
| 5 | Messages - The League.pdf | 175 MB, 3,000+ pages, iMessage export **with text layer** | Resumable local import pipeline (`scripts/chat-import/`) → `ChatImport`/`ChatMessage`; source of league knowledge. **Never** sent through Vercel/browser or committed | Admin-only / private |

## Identity resolution (verified)

All 10 profile-picture filenames and all 10 xlsx names map 1:1 to existing DB managers
via the 2025 Sleeper team name:

| Real name (xlsx / photo) | Current team (xlsx) | Sleeper username (DB `displayName` before this work) |
|---|---|---|
| Anthony Cibilich | Mexico City Diablos | AnthonyCib |
| Blake Mire | Meet Me at da London | Mirecat |
| Ethan Jones | Bustin' Jefferson | Jonesy24811 |
| Gavin Detillier | Eat My Butker | gdetillier8 |
| Logan Javier | Sad Team | loganjavier |
| Michael Barkemeyer | Crashee Rice | mbarkemeyer |
| Michael Shea | Riley Reid Option | Michaelshea7 |
| Patrick McManus | The Shea Knife | thenorthernpike |
| Patrick Schwing | 鼠年 (Chinese) | patrick408287 |
| Quinn Fuentes | TJ HockenZYN | quinnfuentes1 |

Phone numbers are embedded in the chat export (`Name (+phone)`), so phone→manager
resolves automatically during import and is remembered in `ChatIdentityMap`.

## Known review flags
- **Patrick Schwing** profile pic: embedded Snapchat header reads "Quinn Fuentes" → possible mislabel, routed to admin review.
- All 8 league pictures show identifiable people → **UNCERTAIN**, not auto-published.
- Commissioner history is narrated in team-names/nicknames; most champion→manager links are ambiguous and stay PENDING. Pre-2023 rosters included members no longer in the league (e.g. Meghan Rotolo).
