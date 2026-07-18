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

## Phase 0 — Scaffolding (this session)

- [x] Next.js 15 (App Router, TS, Tailwind, ESLint) project init
- [x] Prettier, Vitest, Playwright, Prisma installed
- [x] Folder structure (`src/app`, `src/components`, `src/server`, `src/lib`,
      `prisma`, `tests`)
- [x] `.env.example`
- [x] Prisma schema covering full data model from spec
- [x] Seed script with 5 seasons, 12 managers, matchups, drafts,
      transactions, playoffs, champions, rivalries, records, articles,
      quotes, awards
- [x] Sleeper typed client + mock provider + sync service skeleton
- [x] Historical statistics engine + unit tests
- [x] AI provider interface + mock provider + content services (stubs)
- [x] Chat ingestion provider architecture + plain-text parser (stub data)
- [x] Milestone pages: `/`, `/matchups`, `/matchups/[season]/[week]/[id]`,
      `/standings`, `/managers`, `/managers/[id]`, `/history`,
      `/history/[season]`, `/records`
- [x] Stub pages for remaining routes: `/rivalries`, `/transactions`,
      `/drafts`, `/news`, `/news/[season]/[week]`, `/chat-lore`, `/admin`
- [x] Auth scaffold (NextAuth + roles), basic login
- [ ] Lint, typecheck, unit tests, production build all green

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
