# Implementation Plan — Gridiron Gazette

Fantasy football league platform for a private Sleeper league. Fictional
branding for now: league name **"Gridiron Mayhem Fantasy Football League"
(GMFFL)**, site/newspaper brand **"The Gridiron Gazette"**.

This plan tracks phased delivery. See root `README.md` for setup/run
instructions once scaffolding exists.

## Guiding decisions (defaults chosen, not blocking)

- **Package manager:** npm (ships with Node, no extra install on Windows).
- **Auth:** NextAuth (Auth.js) v5 with Credentials provider (email + password,
  bcrypt hash) for now — no external OAuth app registration required to run
  locally. Roles: `ADMIN`, `MEMBER`. Swappable later.
- **DB:** PostgreSQL via Prisma. Docker Compose provided; Neon/Supabase
  documented as the no-Docker alternative.
- **AI:** `AIProvider` interface with an `OpenAIProvider` and a
  `MockAIProvider`. Mock is used automatically when `OPENAI_API_KEY` is unset.
- **Sleeper:** real typed client (`src/server/sleeper/client.ts`) plus a
  `MockSleeperProvider` used when `SLEEPER_LEAGUE_ID` is unset. A thin
  `SleeperProvider` interface lets sync services depend on either.
- **Charts:** Recharts, client components only, fed pre-shaped data from
  server components.
- **Testing:** Vitest for unit tests (stats engine, repositories, parsers),
  Playwright for a small smoke e2e suite.
- **Styling:** Tailwind v4 + shadcn/ui primitives, dark-mode-first (`class`
  strategy, `dark` set on `<html>` by default).

## Phase 0 — Scaffolding — ✅ COMPLETE

- [x] Next.js 16 (App Router, TS, Tailwind v4, ESLint, Turbopack) project init
  — **note:** this repo was scaffolded on Next.js 16 and Prisma 7, both newer
  than common tutorials assume. Next 16 makes `params`/`searchParams` fully
  async (`Promise`, must `await`) and renames `middleware.ts` → `proxy.ts`
  (`export const proxy = ...`). Prisma 7's `prisma-client` generator outputs
  to `src/generated/prisma/client` (import from `@/generated/prisma/client`,
  not `@/generated/prisma`) and requires an explicit driver adapter
  (`@prisma/adapter-pg`) passed to `new PrismaClient({ adapter })` — see
  `src/lib/db.ts`. Read `node_modules/next/dist/docs/` before assuming any
  Next.js API from prior knowledge; it may have changed.
- [x] Prettier, Vitest, Playwright, Prisma installed
- [x] Folder structure (`src/app`, `src/components`, `src/server`, `src/lib`,
      `prisma`, `tests`)
- [x] `.env.example`, `docker-compose.yml`, `prisma.config.ts`
- [x] Prisma schema covering full data model from spec (31 models, all
      Sleeper IDs nullable, `StandingSnapshot`/`LeagueRecord` designed as
      insert-only/non-destructive history)
- [x] Seed script (`prisma/seed.ts` + `prisma/seed/*`) — 12 managers, 5
      seasons (2021-2024 complete + 2025 in-progress), full weekly
      matchups/rosters/lineups, 5 drafts (960 picks), 100 transactions/trades,
      3 distinct champions (Sofia Reyes ×2, Marcus Cole, Deshawn Griggs), 66
      computed rivalries, all 14 `LeagueRecord` categories computed from real
      simulated data (not hand-authored), sample articles/quotes/awards, a
      sample chat-lore import. Deterministic (seeded PRNG) and idempotent —
      re-running `npm run db:seed` clears and regenerates identical data.
- [x] Sleeper typed client + mock provider + sync service (verified end-to-end
      against a live DB: all 7 sync functions ran successfully with correct
      `DataSyncLog` bookkeeping)
- [x] Historical statistics engine + unit tests (59 tests: career record,
      win%, streaks, all-play, expected wins, schedule luck, lineup
      efficiency, head-to-head, Elo, finishes)
- [x] AI provider interface + mock + OpenAI providers + 9 content services,
      each accepting a `ContentSafeguards` (humor level, sensitive topics,
      no-roast managers) object folded into every prompt (18 tests)
- [x] Chat ingestion provider architecture — real parsers for plain text,
      WhatsApp, GroupMe, Discord, CSV, JSON; iMessage stubbed
      (`NotYetImplementedError`) pending a real export sample; approval-gated
      `getApprovedContextForGeneration()` as the only sanctioned AI-context
      read path
- [x] Repository layer (`src/server/repositories/`) — every page reads
      through here, never calls Prisma directly
- [x] All milestone pages, backed by real seeded data: `/`, `/matchups`,
      `/matchups/[season]/[week]/[matchupId]`, `/standings`, `/managers`,
      `/managers/[managerId]`, `/history`, `/history/[season]`, `/records`
- [x] Remaining routes: `/rivalries`, `/transactions` (filterable),
      `/drafts` (season selector + full board), `/news`,
      `/news/[season]/[week]`, `/chat-lore` (admin-only, explains the import
      pipeline), `/admin` (admin-only dashboard, reads real `DataSyncLog`/
      league/manager counts; most actions are disabled placeholders wired to
      real backing services)
- [x] Auth: NextAuth v5 Credentials + bcrypt + JWT sessions; `src/proxy.ts`
      gates `/admin` and `/chat-lore` to `ADMIN` role, redirecting to `/login`
- [x] Design system: dark-mode-first theme (gold + turf-green brand accent
      over a navy-charcoal base), Oswald headline font + Geist Sans/Mono,
      shared `MatchupCard`/`StandingsTable`/`EmptyState`/`ErrorState`
      components, two Recharts charts (league scoring trend, season points-for)
- [x] Lint, typecheck, unit tests (82 passing), production build (`next
      build`) all green
- [x] End-to-end verification: 15 Playwright tests against a real running
      dev server + seeded database (every page renders, standings/manager
      links work, admin routes redirect when logged out, login with the
      seeded admin account succeeds) — all passing. Manually screenshotted
      the homepage, standings, and managers pages to confirm the design
      renders as intended.

## Phase 1 — Depth on milestone pages (next)

- Full lineup/box-score rendering on matchup detail page
- Playoff bracket visualization on `/history/[season]`
- Recharts trend charts on `/standings` and `/managers/[id]`
- Wire admin manager-identity mapping to real DB writes

## Phase 2 — Live Sleeper sync

- Implement real HTTP calls in `SleeperApiProvider`, point sync service at
  a real `SLEEPER_LEAGUE_ID`
- Background/cron-style sync trigger from `/admin`
- `DataSyncLog` UI

## Phase 3 — AI content generation

- Real `OpenAIProvider` implementation behind the existing interface
- Draft/approve/publish workflow for `Article` + `ArticleSection`
- Humor-level and no-roast settings wired into prompts

## Phase 4 — Chat-lore ingestion

- Real parsers per platform (WhatsApp, iMessage, GroupMe, Discord, CSV/JSON)
- Participant-to-manager mapping UI backed by `ChatParticipant`
- Sensitivity/approval workflow before any message reaches an AI prompt

## Notes from this session

- This session's sandbox had neither Docker nor a native PostgreSQL install
  available, so all development/verification (migrations, seed, the 15
  Playwright e2e tests, manual screenshots) ran against `npx prisma dev` —
  Prisma's own zero-install local Postgres-compatible server. It worked well
  for short-lived scripts but became unreachable once after an extended idle
  period and needed `npx prisma dev stop default && npx prisma dev -d` to
  recover; data survived the restart. This is specific to that lightweight
  dev tool, not to Postgres itself — Docker Compose or a hosted provider
  (both documented in the README) won't have this quirk, and either is
  recommended over `prisma dev` for anything beyond a quick local trial.

## Open questions for the user (non-blocking — using defaults until answered)

1. Real Sleeper league ID (using mock provider until provided).
2. Final league/site name and logo (using "Gridiron Mayhem FFL" / "The
   Gridiron Gazette" placeholder branding).
3. Hosting target for production (not addressed yet — local-only for now).
4. Whether Docker Desktop is available locally (README documents both the
   Docker Compose path and the hosted Postgres path; local Docker presence
   was not probed this session per your tool permission).
5. Actual group-chat export format(s) to expect (architecture is
   provider-based and platform-agnostic; parser stubs use plain text until
   a real export sample is supplied).
