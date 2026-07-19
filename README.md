# The Gridiron Gazette

A private fantasy football league website for the **Gridiron Mayhem Fantasy
Football League (GMFFL)** — a live Sleeper dashboard, a permanent historical
archive, a weekly AI-generated newspaper, and a searchable record of league
lore. Built with Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui,
PostgreSQL + Prisma, Recharts, Zod, NextAuth (Auth.js v5), Vitest, and
Playwright.

This is a phased build. See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
for what's done and what's next.

## Requirements

- **Node.js 20.9+** (project developed/tested on Node 24) and **npm**
- **PostgreSQL 16** — via Docker Desktop, [Prisma's local dev database](#option-b--prisma-local-dev-database-no-docker-no-install)
  (no install needed), or a hosted provider (Neon/Supabase)
- Windows Terminal + PowerShell (all commands below are exact PowerShell)

## 1. Install prerequisites (PowerShell)

```powershell
# Check versions — Node 20.9+ required
node --version
npm --version

# Optional: Docker Desktop, if you want the Docker Compose Postgres path
docker --version
```

If Node isn't installed, get it from https://nodejs.org (LTS) or via
`winget install OpenJS.NodeJS.LTS`.

## 2. Clone and install dependencies

```powershell
cd C:\Users\<you>\gridiron-gazette
npm install
```

## 3. Configure environment variables

```powershell
Copy-Item .env.example .env
```

Then open `.env` and fill in:

- `DATABASE_URL` — see [Database setup](#4-database-setup) below for the three options
- `AUTH_SECRET` — generate one with `npx auth secret`, or:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- `SLEEPER_LEAGUE_ID` — leave blank to run entirely on the built-in mock
  Sleeper provider; fill in once you have a real league ID
- `OPENAI_API_KEY` — leave blank to use the built-in `MockAIProvider` (no
  cost, no network calls); fill in once you want real AI-generated content

## 4. Database setup

Pick **one** of these three options.

### Option A — Docker Compose (recommended if Docker Desktop is installed)

```powershell
docker compose up -d
```

This starts Postgres 16 on `localhost:5432` with the credentials already
matching `.env.example`'s default `DATABASE_URL`
(`postgresql://gridiron:gridiron@localhost:5432/gridiron_gazette?schema=public`).

Stop it later with `docker compose down` (add `-v` to also delete the data
volume).

### Option B — Prisma local dev database (no Docker, no install)

Prisma ships a local, zero-install Postgres-compatible dev server. Useful if
Docker Desktop isn't available:

```powershell
npx prisma dev
```

This prints a `DATABASE_URL` to the terminal — copy it into your `.env`.
Leave that terminal window running while you work; use `npx prisma dev -d` to
run it detached, and `npx prisma dev stop` to stop it later.

### Option C — Hosted Postgres (Neon or Supabase)

1. Create a free project at https://neon.tech or https://supabase.com
2. Copy the connection string it gives you into `DATABASE_URL` in `.env`
   (make sure `sslmode=require` is present for Neon)
3. No local database process to manage — this is the easiest path for a
   quick demo or for deploying somewhere other than your own machine

### Apply the schema and seed data

Once `DATABASE_URL` points at a running Postgres (any of the three options
above):

```powershell
npm run db:migrate    # applies prisma/migrations to your database
npm run db:seed       # loads 5 seasons of fictional league history
```

`db:seed` prints demo login credentials at the end — look for a block like:

```
Done. Demo login credentials:
  Admin (Sofia Reyes, commissioner): admin@gridirongazette.local / GazetteAdmin123!
  Member (Marcus Cole): marcus@gridirongazette.local / MemberPass123!
  Guest (spectator, no manager link): guest@gridirongazette.local / MemberPass123!
```

The seed script is idempotent — re-running `npm run db:seed` clears and
regenerates the same deterministic league history every time, so it's safe
to run again after schema changes.

## 5. Start the app

```powershell
npm run dev
```

Open http://localhost:3000. Sign in with one of the demo accounts above to
see admin-only pages (`/admin`, `/chat-lore`).

## 6. Running tests, lint, and a production build

```powershell
npm run typecheck     # tsc --noEmit
npm run lint           # eslint
npm run test           # vitest (unit tests — stats engine, parsers, AI prompts)
npm run test:e2e       # playwright (requires the dev server; installs browsers on first run)
npm run build           # next build (production build)
```

First-time Playwright setup, if `test:e2e` complains about missing browsers:

```powershell
npx playwright install chromium
```

## Project structure

```
prisma/
  schema.prisma        Full data model (see below)
  seed/                 Seed-data generators (managers, players, schedule, drafts, records, ...)
  seed.ts               Seed entry point (npm run db:seed)
src/
  app/                  Next.js App Router routes (pages, layouts)
  components/
    ui/                  shadcn/ui primitives (Base UI-backed)
    layout/              Header, footer, nav config
    shared/              Cross-page presentational components (cards, empty/error states)
    standings/, charts/  Page-specific components
  server/
    repositories/        Prisma query layer — pages call these, never Prisma directly
    stats/                Pure historical-statistics engine (no I/O) + Vitest tests
    sleeper/              Typed Sleeper API client, mock provider, sync service
    ai/                   AI provider interface, mock + OpenAI providers, content services
    chat-import/          Provider-based group-chat parser architecture
  lib/                  Prisma client singleton, env validation, utils
  auth.ts                NextAuth (Auth.js v5) configuration
  proxy.ts               Route protection for /admin and /chat-lore (Next.js 16's
                           replacement for middleware.ts)
```

## Data model

The Prisma schema (`prisma/schema.prisma`) is normalized around: `User`,
`League`, `Season`, `Manager`, `FantasyTeam`, `TeamNameHistory`, `Roster`,
`FantasyPlayer`, `Matchup`/`MatchupTeam`, `WeeklyPlayerScore`,
`StandingSnapshot`, `Draft`/`DraftPick`, `Transaction`/`TransactionAsset`/
`Trade`, `PlayoffBracket`, `Championship`, `LeagueRecord`, `Rivalry`,
`Article`/`ArticleSection`, `Award`, `ChatImport`/`ChatParticipant`/
`ChatMessage`/`ChatTag`, `HistoricalQuote`, `AIContentGeneration`, and
`DataSyncLog`.

Sleeper IDs are stored where relevant (`sleeperLeagueId`, `sleeperUserId`,
`sleeperRosterId`, `sleeperPlayerId`, ...) but are all nullable — nothing in
the schema *requires* a Sleeper connection, which is what lets the whole
site run on seeded/mock data with no real league configured.

**Historical snapshots are preserved, not overwritten.** `StandingSnapshot`
is insert-only — every sync appends a new point-in-time row rather than
updating a previous week's standings, so `/history/[season]` can chart
the season exactly as it looked at the time. `LeagueRecord` keeps a
`supersededAt` field so old record-holders aren't deleted when a new one is
set.

### Prisma 7 notes

This project uses Prisma 7's newer `prisma-client` generator (not the older
`prisma-client-js`), which changes two things from older Prisma tutorials:

- The generated client lives at `src/generated/prisma/` and is imported from
  **`@/generated/prisma/client`** (not `@/generated/prisma`) — always import
  the singleton at `src/lib/db.ts` instead of instantiating `PrismaClient`
  yourself.
- The database connection is configured in **`prisma.config.ts`** (used by
  the Prisma CLI for migrate/seed/studio) and separately via a `pg` driver
  adapter in `src/lib/db.ts` (used by the running app) — both read
  `DATABASE_URL` from `.env`, but there's no `url = env(...)` line in
  `schema.prisma` itself.

## Historical statistics engine

`src/server/stats/` is a pure, dependency-free calculation library (no
Prisma, no I/O) with a full Vitest suite. Formulas, in brief (see in-code
comments for the exact implementation):

| Stat | Formula |
|---|---|
| Winning percentage | `(wins + 0.5 × ties) / games played` |
| All-play record | Each week, compare a team's score against every other team's score that week (not just their actual opponent) |
| Expected wins | Sum, across weeks, of that week's all-play win rate |
| Schedule luck | Actual wins − expected wins |
| Lineup efficiency | Starters' actual points ÷ the best possible starting lineup that week |
| Elo rating | Standard logistic Elo: `expectedA = 1 / (1 + 10^((ratingB − ratingA) / 400))`, K=32 by default |
| Streaks | Longest run of consecutive identical results; a tie breaks a streak rather than extending it |

Run just this suite with `npx vitest run src/server/stats`.

## Sleeper integration

`src/server/sleeper/client.ts` is a typed client for Sleeper's public REST
API (user/league/rosters/matchups/transactions/drafts/traded picks/
winners-losers brackets/player metadata), with an in-memory cache (short TTL
for live data, 24h for the large `/players/nfl` dump) and a small concurrency
cap to stay rate-conscious.

`src/server/sleeper/mock-provider.ts` implements the same `SleeperProvider`
interface with deterministic fixture data, so the app works with **zero**
`SLEEPER_LEAGUE_ID` configured. `getSleeperProvider()` picks the real client
or the mock automatically based on whether `SLEEPER_LEAGUE_ID` is set.

`src/server/sleeper/sync-service.ts` exposes `syncCurrentLeague`,
`syncSeason`, `syncAllSeasons`, `syncWeek`, `syncTransactions`,
`syncDrafts`, and `recalculateStatistics` — every call is logged to
`DataSyncLog` (status, error message, records processed).

## AI content architecture

No page ever calls OpenAI directly. `src/server/ai/get-ai-provider.ts`
picks `OpenAIProvider` or `MockAIProvider` based on whether
`OPENAI_API_KEY` is set; both implement the same `AIProvider` interface.
Content services (`src/server/ai/services/*.ts` — matchup previews/recaps,
weekly summaries, power rankings commentary, manager profiles, season
summaries, trade retrospectives, weekly awards, quote selection) take
**structured data**, never raw database dumps, plus a `ContentSafeguards`
object (`humorLevel`, `sensitiveTopics`, `noRoastManagerNames`) that's folded
into every prompt. Every generation is logged to `AIContentGeneration`
(prompt version, provider, full input/output) and defaults to `GENERATED`
status — nothing auto-publishes.

## Group-chat ingestion architecture

`src/server/chat-import/` is a provider-based parser architecture
(`ChatParser` interface) with working parsers for plain text, WhatsApp,
GroupMe, Discord, CSV, and JSON exports (iMessage is stubbed pending a real
export sample — export formats vary too much by tool to guess safely).
Every parser produces the same canonical `CanonicalParsedMessage` shape.
`getApprovedContextForGeneration()` in `context-retrieval.ts` is the *only*
sanctioned way AI-generation code may read chat history — it returns a
narrow, filtered slice of already-`APPROVED` and non-sensitive messages,
never the full archive.

## Security notes

- Auth is NextAuth (Auth.js v5) with a Credentials provider, bcrypt password
  hashing, and JWT sessions (no `Account`/`Session` tables needed).
- `/admin` and `/chat-lore` are gated by `src/proxy.ts` (Next.js 16's
  renamed `middleware.ts`) — both require an authenticated `ADMIN` user.
- No API key (Sleeper, OpenAI) is ever imported into a Client Component;
  `src/lib/env.ts` is server-only.
- Soft deletion (`deletedAt`) is used on `User`, `Manager`, `Article`, and
  `ChatMessage`.

## Known gaps / next phases

See `docs/IMPLEMENTATION_PLAN.md` for the full phased roadmap. In short:
live Sleeper sync is wired but untested against a real league; AI content
services exist but aren't yet wired into an admin approval UI; chat-lore
upload is a UI placeholder (the parsing/import service underneath it is
real and tested).
