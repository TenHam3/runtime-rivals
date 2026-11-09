# Runtime Rivals — Phase 1 Implementation Plan (Lean v0)

> This file is the durable, in-repo copy of the approved plan, so a future session can resume work by just opening this directory and reading this file — no need to hunt through `~/.claude/plans`. Check off milestones in the Progress Checklist as they're completed.

## Progress Checklist

- [ ] M0: Repo scaffolding (pnpm/turborepo, tsconfig, lint, Vitest + `turbo test`), git init + GitHub repo + CI workflow, docker-compose with `postgres` + `judge` (C++/Python runtimes installed) + `web` + `caddy`, `.env.example`, empty `apps/web` Next.js package
- [ ] M1: Prisma schema for `Problem`/`TestCase` + migrations + importer (with `--dry-run`) that loads `problems/*` packages (Kattis format) + importer tests
- [ ] M2: `apps/server` skeleton (Fastify + Socket.IO), guest-session cookie issuance
- [ ] M3: Lobby/slot/invite flow (in-memory store) incl. side cap, lock-at-start, rejoin, host migration + lobby-rule tests
- [ ] M3.5: `apps/web` skeleton: guest name, lobby create/join by invite code, slot picker, WS presence, match-page placeholders
- [ ] M4: `judge-client` package (Piston adapter) + language registry + checker module, proven standalone + checker tests
- [ ] M5: Submission flow + run-on-samples, wired to Match/MatchSlot store, direct judge call, WS broadcast + scoring tests (+ submit/run buttons, status UI)
- [ ] M6: Match lifecycle (ICPC/race modes, problem selection, timer, end-early, rematch, matchId-scoped rooms) + in-memory live scoreboard (+ timer / scoreboard UI)
- [ ] M7: Code editor sync: Yjs doc hosted on Liveblocks (`@liveblocks/yjs` + y-monaco), slot-scoped Liveblocks auth endpoint on `apps/server` (+ Monaco editor area, shared language selector)
- [ ] M8: tldraw whiteboard sync via Liveblocks Storage (second room per slot, same auth endpoint) (+ tldraw area)
- [ ] M9: Chat (WS events, in-memory store, scoped per lobby/slot) (+ chat area)
- [ ] M10: Hardening + full manual smoke test (incl. via Cloudflare tunnel)

**Status (2026-11-09)**: M0 scaffolding is in place and pushed to https://github.com/TenHam3/runtime-rivals — monorepo (`@rr/web`, `@rr/shared-types`, `@rr/db`, `@rr/judge-client`, `@rr/config`), lint/typecheck/test/build passing, CI workflow, compose + Caddyfile, `.env.example`, `scripts/install-piston-runtimes.mjs`. **Remaining for M0**: start Docker Desktop, `docker compose up -d --build`, run the Piston runtime script, confirm http://localhost:8080 serves the web app; confirm CI is green on GitHub. Then tick M0 and start M1.

Dev-environment notes:
- Repo intentionally stays in OneDrive (user decision). If installs/builds hit `EBUSY`/`EPERM` file locks, pause OneDrive sync or move the repo to e.g. `C:\dev\runtime-rivals`.
- Node 22.13's bundled corepack (0.30) has outdated npm signing keys and can't download pnpm. Fixed by `npm i -g corepack@0.36.0` (installs into `%APPDATA%\npm`, no admin needed) and `corepack enable pnpm` from there. pnpm version is pinned in root `package.json` (`packageManager`).
- pnpm 12 refuses packages published in the last 24h (`minimumReleaseAge`). If an install adds a `minimumReleaseAgeExclude` block to `pnpm-workspace.yaml`, pin a slightly older version instead of keeping the exclusion.
- ESLint is pinned to 9.x because `eslint-config-next`'s plugins (react, jsx-a11y, import) don't support ESLint 10 yet. TypeScript is pinned to 5.9 (typescript-eslint doesn't support TS 7).
- Workspace packages export TypeScript source (`"exports": "./src/index.ts"`) — no per-package build step; Next compiles them via `transpilePackages`.
- Docker Desktop must be running (WSL2 backend) for compose.

---

## Context

This is a brand-new project (currently empty) to build a custom competitive-programming dueling platform for the user and their friends — like Codeforces/LeetCode contests, but with real-time collaborative team battles and a shared whiteboard. The key product idea driving the architecture: matches happen in **invite-only, guest-friendly lobbies** where people land on freeform sides ("anyone can be on anyone's team"), rather than pre-existing persistent teams. The user wants a working implementation up **as soon as possible**, so Phase 1 is deliberately minimal: these are disposable, one-off practice sessions with friends — nothing about a match needs to survive past the session, so persistence, accounts, ratings, and established teams are all pushed to a prioritized future roadmap rather than built now. Collaborative document sync is handled by Liveblocks so the MVP ships fast.

**Work split**: the user owns the backend by default (REST, Socket.IO, judge integration, server-side match rules). Claude Code builds the frontend (skeleton at M3.5, filled in alongside M5–M9) and can also be used for any other task the user chooses — DB setup, tool-specific integration code, debugging, and so on. For pure-logic modules, Claude Code writes the failing tests from the rules in this file and the user implements code to make them pass (see Testing).

## Locked decisions

- **Stack**: TypeScript end-to-end. Next.js/React frontend. A single Node.js backend service (not Next.js API routes).
- **Package manager / monorepo**: pnpm (enabled via corepack, pinned with `packageManager` in root `package.json`) + Turborepo. pnpm's strict `node_modules` prevents packages from importing undeclared dependencies; internal packages link via `workspace:*`.
- **Real-time collab**: Yjs for the collaborative code editor (Monaco + y-monaco), with the Yjs doc hosted on Liveblocks (`@liveblocks/yjs`). The collaborative whiteboard is tldraw, synced through Liveblocks Storage. See "Why Liveblocks for document sync" below.
- **Database**: PostgreSQL via Prisma (schema, migrations, generated client), used only for the one thing that must survive restarts in Phase 1 — the problem bank.
- **Problem bank format**: problems are authored in the repo as folders in the Kattis/ICPC Problem Package Format (problemarchive.org), using a subset: `problem.yaml`, `statement/problem.en.md`, `data/sample/*.in|.ans`, `data/secret/*.in|.ans`, and optionally `submissions/accepted/`. Sample vs. hidden is determined by folder path; scoring groups (`data/secret/<group>/`) map to `points` (stored but unused for ranking in Phase 1). Pin one version of the spec. Optionally run Kattis `problemtools` (`verifyproblem`) on a package before importing it.
- **Match modes** (host picks per lobby):
  - **ICPC**: a set of problems; rank by problems solved, then penalty time. Defaults (host-adjustable): penalty 20 minutes per wrong attempt, counted only on problems eventually solved; compile errors don't count as attempts; duration 60 minutes. Further tie-break: earlier time of last accepted solve.
  - **Single-problem race**: one problem; the first Accepted wins and ends the match.
- **Problem selection**: the host either hand-picks problems from the bank (several for ICPC, one for race) or randomizes by count + difficulty range. Problem titles/statements are hidden from players until the match starts.
- **Sides**: the host sets a max players per side (default 3). Players switch sides freely in the lobby; sides lock when a match starts. A disconnected player can rejoin their own side.
- **Match lifecycle**: a match ends when the server-authoritative timer expires, or early when everything is solved (ICPC: every team solved every problem; race: first Accepted). No manual end button. If the host is absent for more than ~60s, the host role passes to the longest-present participant. A lobby can run multiple matches in a row (rematch with same sides/settings).
- **Opponent visibility**: per-problem scoreboard cells, Codeforces/LeetCode-style — attempt count, solve time, and a "judging" indicator. Opponents' code and failure types (WA/TLE/RE) stay hidden until the match ends.
- **Run on samples**: players can run their code against the problem's sample tests without it counting — no `Submission` is created and the scoreboard is never touched. Separately rate-limited.
- **Languages**: C++ (g++, C++17/20) and Python 3. All per-language details live in a single **language registry** in `packages/shared-types` — `id, label, piston {language, version}, judge0LanguageId?, monacoLanguageId, sourceFilename, timeLimitMultiplier, starterTemplate`. Server, judge-client, and web all read from it, so adding a language is one registry entry + one Piston runtime install. The slot's active language lives in the shared Yjs doc so teammates always see the same one.
- **No Redis, no queue** in Phase 1 — a judge call is a direct async function call, not a queued job. Introduced later once there's a concrete reason (see roadmap).
- **Judging**: Piston (single-container, simplest to stand up), behind a `JudgeClient` interface so swapping to Judge0 later is a single new adapter:
  - `JudgeClient.run({ languageId, source, tests[], timeLimitMs, memoryLimitMb })` returns *raw* per-test results — `{ stdout, stderr, compileOutput, exitCode, signal, timedOut, timeMs?, memoryKb? }`. No backend-specific status codes leave the adapter.
  - Verdicts are assigned by our own backend-independent **checker** module (AC/WA/TLE/RE/CE): whitespace-tolerant token comparison by default, optional float tolerance from `problem.yaml`. Verdict semantics therefore don't change when the judge backend changes.
  - Judge0's async submit-then-poll flow would stay hidden inside its adapter behind the same `async run()`.
- **Testing**: test-driven for pure logic, using Vitest — checker/verdicts, ICPC + race scoring/ranking/end-early detection, problem importer validation, lobby/side rules incl. host migration. Tests are written first in the milestone that introduces each module. Integration code (Fastify routes, Socket.IO, Liveblocks, editor binding) is built first and verified manually / in the M10 smoke test.
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) on every push/PR — `pnpm install --frozen-lockfile`, `pnpm turbo lint typecheck test build`, and the importer's `--dry-run` over `problems/` so a malformed problem package fails CI. No Docker services needed. No CD until cloud deployment.
- **Hosting**: local via Docker Compose, with all config externalized via env vars from day one (no hardcoded `localhost` in source), so a later cloud VM migration stays cheap. Document sync goes through Liveblocks, so it needs internet access and a Liveblocks account (keys via env vars).
- **Sharing with friends**: a `caddy` service is the single public origin, and a Cloudflare quick tunnel exposes it (see "Sharing with friends" below).
- **Domain model**: no persistent `Team`, no persistent `User`, no persistent `Match`/`Submission` history. A participant is a display name tied to a short-lived session token. Lobby → MatchSlot (side) → SlotParticipant (who's on that side) is the one mechanism that both freeform play *and* future established Teams will eventually reuse — it just lives in memory for now instead of in Postgres. The schema is not hardcoded to exactly two sides: a Lobby has a one-to-many relationship to MatchSlot, so N-way (not just 1v1/2-team) matches are already architecturally supported — the only undecided piece is whether lobby creation lets the host pick N up front (open product question, not a schema constraint).
- **Whiteboard**: tldraw — its record-based store maps cleanly onto Liveblocks Storage, and its custom-shape support is the foundation for data-structure drawings later. Pin the tldraw version (its API changes between majors, and Liveblocks' tldraw example is copy-and-adapt code, not a maintained package). Confirm tldraw's license terms (non-commercial/hobby license key) before M8.
- **Chat**: text only, ephemeral, scoped per lobby/slot.

## Why Liveblocks for document sync

- **No sync server to run** — no CRDT relay process to configure, host, or debug.
- **One WebSocket server in the backend** — Socket.IO is the only thing handling WebSocket upgrades on `apps/server`, so there's no path-based upgrade routing to manage.
- **Persistence, reconnection, and scaling are handled** — document content survives backend restarts, clients reconnect transparently, and running multiple backend instances later needs nothing extra for document sync.
- **The backend stays small** — its only role in document sync is issuing room-access tokens; it never relays edits.

**Portability**: the code doc is plain Yjs, so self-hosting it later is a client-provider + auth-endpoint swap rather than a data migration.

## Phase 1 data model

**Persisted in Postgres (the only tables in Phase 1):**
- **Problem** — `id, slug, title, statementMarkdown, difficulty, timeLimitMs, memoryLimitMb, floatTolerance?, createdAt`
- **TestCase** — `id, problemId, input, expectedOutput, isSample, orderIndex, points`

Normalized rows (not a JSON blob on Problem) so judging can iterate/join per-test results cleanly. Loaded from `problems/*` packages by an importer (`pnpm db:import`): it validates `problem.yaml` with Zod, upserts `Problem` by `slug`, and deletes + re-inserts that problem's `TestCase` rows in one transaction, so edits and removals propagate on re-run. `pnpm db:import --dry-run` validates every package without touching the database (used by CI). Test input/output is stored as text columns in Phase 1. No admin UI.

**In-memory only (lives for the duration of the backend process, gone on restart):**
- **Session** — `sessionId (signed cookie/JWT), displayName` — stands in for a persistent `User` table. No signup, no password, no row in any database.
- **Lobby** — `id, inviteCode, name, hostSessionId, status, settings`
  - `settings` — `mode ('icpc' | 'race'), problemSelection ({ kind: 'manual', problemIds[] } | { kind: 'random', count, minDifficulty, maxDifficulty }), durationSeconds, penaltyMinutes, maxPerSide`
- **MatchSlot** — `id, lobbyId, label, slotIndex`
- **SlotParticipant** — `matchSlotId, sessionId, joinedAt, leftAt?` — the core "who's on which side" mechanism; this exact shape is what Phase 2 persistence and later Established Teams both build on.
- **Match** — `id, lobbyId, mode, problemIds[], status, startedAt, endedAt, durationSeconds, penaltyMinutes` (a lobby has many matches over time — rematches)
- **Submission** — `id, matchId, matchSlotId, problemId, sourceCode, language, status, verdict, submittedAt` + its test-case results inline (no separate persisted table yet). Sample runs are **not** Submissions.
- **ChatMessage** — `scopeType, scopeId, sessionId, body, createdAt`

The scoreboard is derived from Submissions per match (attempts, first-AC time, penalty) by a pure scoring module — the unit-tested core of M5/M6.

A plain in-process store (e.g. a few `Map`s keyed by id, wrapped in small repository-style modules) is enough — no need for Redis to hold this.

**Held by Liveblocks (outside the backend process):**
- **Document content** — code and whiteboard live in Liveblocks rooms `code:<matchId>:<matchSlotId>` / `whiteboard:<matchId>:<matchSlotId>` (match-scoped so rematches get fresh rooms). Liveblocks persists them, so they survive a backend restart. To keep sessions disposable, the server deletes a match's rooms at match end via `@liveblocks/node`.

## Service architecture

**`caddy`** — single origin in front of everything: `/api/*`, `/socket.io/*`, `/liveblocks-auth` → `server`; everything else → `web`. Keeps the guest cookie first-party and avoids cross-origin cookie/CORS issues when accessed through a tunnel.

**`apps/server`** — one Node process (Fastify for REST, Socket.IO for WS):
- REST: guest-session issuance (sets the signed cookie), lobby create/join-by-invite-code, lobby settings (host only), slot join/leave (enforcing side cap + lock-at-start), problem listing for the host's picker, submission creation, sample runs (`POST /api/run`), match start (host only).
- WS (Socket.IO): lobby-wide presence, host-migration notices, chat fan-out, submission status push, live scoreboard push, match timer sync, match end. (In-*document* presence/cursors come from Liveblocks — Yjs awareness through the Liveblocks provider for the editor, Liveblocks presence for tldraw — so this channel is only for lobby-wide "who's online.")
- Liveblocks auth: `POST /liveblocks-auth` reads the guest-session cookie, checks slot membership, and grants access to that slot's two rooms for the current match only (`code:<matchId>:<matchSlotId>`, `whiteboard:<matchId>:<matchSlotId>`) via a `@liveblocks/node` session signed with the secret key. Room deletion at match end lives in the match-lifecycle code.
- Judging: the submission handler calls `JudgeClient.run(...)` directly and awaits raw results in-process — no queue — then the checker assigns the verdict. Writes the result into the in-memory `Submission` store and broadcasts over WS. Sample runs use the same path with sample tests only and skip the store/scoreboard.
- Match lifecycle: start (resolves problem selection, locks sides), server-authoritative timer, end-early check after every accepted submission, end (rejects further submissions, deletes Liveblocks rooms), host migration timer on host disconnect.

**Client (Claude Code)**: `@liveblocks/client` / `@liveblocks/react`; Monaco + y-monaco on `LiveblocksYjsProvider` (language selector bound to the shared Yjs doc, modes from the language registry); tldraw loaded with `dynamic(..., { ssr: false })` and bound to a Liveblocks `LiveMap` of tldraw records keyed by record id (adapted from Liveblocks' tldraw example).

**Submission flow**: client POSTs current editor buffer → server checks slot membership + match-still-running (server-authoritative timer, not client clock) + simple in-memory rate check → calls Piston via `JudgeClient` → checker assigns verdict → scoring module recomputes the scoreboard → broadcasts `submission:result` (full detail to own side only) / `scoreboard:update` (per-problem cells to everyone) over WS → end-early check. No Postgres writes, no queue — this is the piece the roadmap below adds first.

## Docker Compose layout (local dev)

| service | purpose | key env vars |
|---|---|---|
| `caddy` | single origin / reverse proxy (`Caddyfile`) | exposes one host port (e.g. 8080) |
| `web` | Next.js app | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` |
| `server` | REST + WS + Liveblocks auth + judge calls | `DATABASE_URL`, `JUDGE_API_URL`, `CORS_ALLOWED_ORIGINS`, `SESSION_SECRET`, `LIVEBLOCKS_SECRET_KEY`, `PORT` |
| `postgres` | Postgres 16 + named volume + healthcheck | `POSTGRES_USER/PASSWORD/DB` (holds only Problem/TestCase) |
| `judge` | Piston (`privileged: true`, volume for `/piston/packages`) | internal `http://judge:2000` |

No `redis`, no `worker`, no `sync` service in Phase 1.

Piston ships with no languages: after the `judge` container is first up, install the registry's runtimes once via `POST /api/v2/packages` (C++ via gcc, Python 3), and verify with `GET /api/v2/runtimes`. The packages volume keeps them across restarts.

The `server` image runs `prisma generate` at build time and `prisma migrate deploy` before start, so a fresh container always has the generated client and an up-to-date schema.

**Env rule (a Phase 1 rule, not a retrofit)**: inter-service URLs come from env vars, never hardcoded in source; `.env.example` committed, real `.env` gitignored. Compose's `environment:` uses service names (`postgres`, `judge`); when running `server`/`web` on the host with `pnpm dev`, `.env` uses `localhost` equivalents instead. This is what keeps a later cloud VM migration (same compose topology + Caddy + `.env.production`) cheap.

### Sharing with friends

Run a Cloudflare quick tunnel pointed at Caddy: `cloudflared tunnel --url http://localhost:8080`. It prints a public `https://<random>.trycloudflare.com` URL to send to friends — no account, no router port forwarding, WebSockets supported. The URL changes each run, which is fine for one-off sessions. Liveblocks traffic goes directly from browsers to Liveblocks' cloud (not through the tunnel); Piston and Postgres are never exposed.

## Repo structure

```
runtime-rivals/
  .github/workflows/ci.yml  # lint, typecheck, test, build, problem-package dry-run
  apps/
    web/              # Next.js frontend — empty package at M0, skeleton at M3.5
    server/           # REST + WS + Liveblocks auth, single process
  packages/
    shared-types/     # Zod schemas / TS types — REST DTOs + WS event payloads + language registry
    db/                # Prisma schema + migrations + problem-package importer (Problem/TestCase only)
    judge-client/      # JudgeClient interface + Piston adapter + checker (Judge0 adapter later behind same interface)
    config/            # zod-validated env parsing
  problems/           # Kattis-format problem packages: problem.yaml, statement/, data/sample, data/secret
  Caddyfile
  docker-compose.yml
  .env.example
  turbo.json
  pnpm-workspace.yaml
  PLAN.md             # this file
```

## Phase 1 build order

| # | Milestone | Depends on |
|---|---|---|
| M0 | Repo scaffolding (pnpm/turborepo, `tsconfig.base.json`, ESLint/Prettier, Vitest + `turbo test`); `git init` + GitHub repo + `.github/workflows/ci.yml`; compose with `postgres` + `judge` + `web` + `caddy` (+ `Caddyfile`); install C++/Python runtimes in Piston; `.env.example` (incl. `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL`); empty `apps/web` Next.js package (TS, App Router) and empty workspace packages so everything is in the monorepo wiring from day one | — |
| M1 | Prisma schema for `Problem`/`TestCase` + migrations + importer (with `--dry-run`) for `problems/*` packages, with a couple of real problems authored in Kattis format. Tests first: importer validation against fixture problem folders | M0 |
| M2 | `apps/server` skeleton (Fastify + Socket.IO), guest-session cookie issuance | M0 |
| M3 | Lobby/slot/invite flow (in-memory store): create lobby, settings, resolve invite code, join/leave/switch slot, side cap, lock-at-start, rejoin own side, host migration. Tests first: lobby/side rules | M2 |
| M3.5 | `apps/web` skeleton: API client typed from `shared-types` Zod schemas + Socket.IO client hook; pages for display name (guest cookie) → create/join lobby by invite code → lobby view with slot join/leave + live presence; placeholder match page with empty problem/editor/whiteboard/chat/scoreboard areas | M3 |
| M4 | `judge-client` package: `JudgeClient` interface + Piston adapter, language registry in `shared-types`, checker module; proven standalone (run code, get a verdict back). Tests first: checker/verdicts | M0, `judge` container |
| M5 | Submission flow + run-on-samples wired to Match/MatchSlot in-memory store, direct judge call, WS result broadcast. Tests first: ICPC + race scoring/ranking. UI: submit + run buttons, submission status, sample-run output | M3.5, M4 |
| M6 | Match lifecycle: modes, problem selection (manual/random), start, server-authoritative timer, end-early detection, end (incl. deleting the match's Liveblocks rooms), rematch, in-memory live scoreboard. Tests first: end-early detection. UI: host settings, timer + scoreboard | M3.5, M5 |
| M7 | Code editor sync: Yjs doc hosted on Liveblocks (`@liveblocks/yjs` + y-monaco), slot-scoped `POST /liveblocks-auth` on `apps/server` with matchId-scoped room names; UI: Monaco editor area + shared language selector | M3.5 |
| M8 | tldraw whiteboard sync via Liveblocks Storage (second room per slot, same auth endpoint); UI: tldraw area | M7 |
| M9 | Chat: WS events, in-memory store, scoped per lobby/slot; UI: chat area | M6 |
| M10 | Hardening: rate limiting (submissions + sample runs), match-end submission rejection, slot-membership authz checks (REST + Liveblocks rooms), opponent-detail hiding, full manual smoke test incl. over the Cloudflare tunnel | all above |

M4 (judge integration) and M7 (editor sync) are the most independent tracks once M2/M3 exist — good candidates to alternate between. M3.5 (web skeleton) can run in parallel with M4, since the judge needs no UI. The skeleton waits for M3 so it's built against the real lobby/session contract rather than guesses, and must exist before M5 so M5–M9 can be exercised in a browser (M7/M8 can't be verified any other way).

## Future feature roadmap (ordered by ease + dependency)

1. **Submission/match/chat persistence to Postgres** — cheapest addition; you're already computing this data in-memory, so it's "write it to a table too," not new logic. Add `Match`, `Submission`, `TestCaseResult`, `ChatMessage` tables. Unlocks crash recovery and is the prerequisite for everything below that needs history.
2. **Test data in object storage** — move `.in`/`.ans` contents to S3-compatible storage (e.g. MinIO locally); `TestCase` keeps an object key in place of the text, and the importer uploads the files. Trigger: test files reach the MB range, or database size/backups get heavy. Mostly an importer + judge-client change, not new domain logic.
3. **Redis for live state + a judge queue (BullMQ)** — worth adding once judging needs to be decoupled from the request thread, or you want live match state to survive a process restart without a full Postgres round-trip. Mostly infra/config, not new domain logic.
4. **Registered user accounts** (beyond guest/session) — moderate effort (real signup/login), and the prerequisite for ratings and teams actually meaning something across sessions instead of resetting every time.
5. **Session leaderboards / stats** — quick once #1 and #4 exist; mostly aggregation queries over already-persisted submissions.
6. **Established Teams** (persistent roster, prefill-a-lobby-slot) — moderate; needs #4 to matter, but the mechanism (bulk-insert into the existing `SlotParticipant` shape) stays simple since it reuses what Phase 1 already built.
7. **Ratings (ELO-style)** — moderate; needs #1 (submission history) and #4 (persistent identity) to be meaningful. The algorithm itself is simple; the bookkeeping (recompute after each match, store history) is the real work.
8. **Custom data-structure shapes in tldraw** — independent track, doesn't depend on anything above. Likely the most frontend-heavy item on this list (building custom shape types), but can happen any time.
9. **Scoreboard freeze** — optional ICPC-style "freeze the scoreboard for the last N minutes" lobby setting. Small, independent.
10. **More languages** (Java, JS/TS, …) — one registry entry + one Piston runtime install each; tune `timeLimitMultiplier` (e.g. Java ~1.5–2×) and compile timeouts for slow compilers (Kotlin/Scala).
11. **Judge0 swap** — new adapter behind `JudgeClient` (numeric language ids via `judge0LanguageId`, submit-then-poll hidden in the adapter; checker unchanged). Main risk is infra: Judge0's sandbox has historically required cgroup v1, which is awkward on Docker Desktop/WSL2 — prove it runs standalone before committing.
12. **Voice chat** — independent, but the highest new-infra cost (needs an SFU like LiveKit/mediasoup) — a whole new service, not a tweak.
13. **Cloud deployment** — pure ops, independent, do it whenever friends need to join without your machine being on (or need a stable URL instead of a quick tunnel). Adds a CD job to the existing GitHub Actions workflow.
14. **Spectators** — lobby members not on any side who can watch the scoreboard and lobby chat. Low priority; possibly never.

## Critical files

- `docker-compose.yml`, `Caddyfile`
- `.github/workflows/ci.yml`
- `packages/db/prisma/schema.prisma` — Problem/TestCase only
- `packages/db/src/import-problems.ts` — problem-package importer (+ `--dry-run`)
- `problems/<slug>/problem.yaml` (+ `statement/`, `data/`) — one folder per problem
- `packages/shared-types/index.ts` (+ language registry)
- `packages/judge-client/src/` — `JudgeClient` interface, Piston adapter, checker
- `apps/server/src/server.ts`
- `apps/server/src/routes/liveblocks-auth.ts`
- `apps/server/src/store/` (in-memory Lobby/MatchSlot/SlotParticipant/Match/Submission/ChatMessage modules)
- `apps/server/src/scoring/` — ICPC + race scoring/ranking/end-early (pure, unit-tested)

## Verification plan (local, end-to-end)

1. `pnpm install && pnpm turbo lint typecheck test build` passes locally, and the same CI workflow is green on GitHub.
2. `docker compose up -d postgres judge`, confirm C++/Python in Piston's `GET /api/v2/runtimes`, `prisma migrate deploy`, run the problem importer, confirm `Problem`/`TestCase` rows exist (e.g. via Prisma Studio). Re-run the importer and confirm no duplicates. Break a `problem.yaml` and confirm `--dry-run` fails.
3. `docker compose up -d server web caddy`, confirm `/api/health` through Caddy.
4. Guest session A creates a Lobby → gets invite code + default slots; sets mode/problems/side cap.
5. Guest session B (second browser/incognito) resolves the lobby by invite code, joins the other slot → confirm session A gets a WS presence event. Confirm the side cap is enforced.
6. Start an ICPC match → confirm WS timer broadcast, zeroed scoreboard, problems revealed only now, and that side switching is rejected.
7. Two tabs joined to the same slot's editor → type in one → confirm live sync in the other via Liveblocks; switch language in one → confirm it switches in the other.
8. Repeat for the tldraw whiteboard (draw in one tab, confirm it appears in the other). Also confirm a session from the *other* slot is denied access to that slot's rooms by `/liveblocks-auth`.
9. Run on samples → confirm output/verdict shown to that side only and **no** scoreboard change.
10. Submit a correct solution → confirm `queued→judging→completed` WS transitions and a scoreboard update in both sessions; the opponent sees the cell but not the code or failure type.
11. Submit an intentionally wrong/slow solution → confirm the verdict (WA/TLE), penalty only applied once that problem is later solved, and that a compile error adds no penalty.
12. Send chat in each slot's scope → confirm no cross-slot leakage.
13. Disconnect the host for >60s → confirm host migrates to the longest-present participant.
14. Let the match timer expire → confirm further submissions are rejected server-side regardless of client clock, and that the match's Liveblocks rooms are deleted.
15. Rematch in the same lobby in **race** mode → confirm fresh (empty) editor/whiteboard rooms, and that the first Accepted ends the match immediately.
16. Start `cloudflared tunnel --url http://localhost:8080` and join from a device on a different network (e.g. phone on mobile data) → confirm guest cookie, WS, editor sync, and submissions all work.
17. Restart the `server` container mid-session → confirm the lobby/match state is gone (expected — in-memory only), that imported Problem/TestCase data in Postgres survives untouched, **and** that Liveblocks room content still exists (it lives outside the backend process). This three-way split (ephemeral match state vs. durable problem bank vs. externally held documents) is the core Phase 1 trade-off to explicitly confirm. Rooms belonging to a match interrupted by a restart won't be cleaned up by the match-end hook — acceptable for Phase 1.
