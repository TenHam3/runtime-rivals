# Runtime Rivals

A competitive-programming dueling platform for playing with friends. Matches happen in invite-only, guest-friendly lobbies: players pick a side, then each side solves problems together in a shared code editor and whiteboard, judged in real time. There are two modes, **ICPC** (most problems solved, then least penalty time) and **race** (first Accepted wins).

Phase 1 is deliberately minimal and disposable: no accounts and no match history. Only the problem bank is stored in Postgres. The full design, decisions, and milestone checklist are in [PLAN.MD](PLAN.MD).

## Tech stack

| Area          | Choice                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Monorepo      | pnpm workspaces + Turborepo, TypeScript throughout                                                    |
| Frontend      | Next.js (App Router) + React; Monaco + Yjs editor and tldraw whiteboard synced via Liveblocks (M7–M8) |
| Backend       | Single Node service: Fastify (REST) + Socket.IO (M2+)                                                 |
| Database      | PostgreSQL 16 via Prisma 7 (problem bank only)                                                        |
| Judging       | Piston (C++ and Python 3), behind a `JudgeClient` interface (M4)                                      |
| Problems      | Kattis problem package format, version `2025-09`                                                      |
| Tests / CI    | Vitest; GitHub Actions on every push and PR                                                           |
| Local hosting | Docker Compose + Caddy (single origin); a Cloudflare quick tunnel for friends                         |

## Repo layout

```
apps/web/               Next.js frontend
apps/server/            REST + WebSocket backend (arrives in M2)
packages/db/            Prisma schema + migrations, problem-package importer
packages/shared-types/  Zod schemas / TS types shared by server and web
packages/judge-client/  JudgeClient interface, Piston adapter, checker (M4)
packages/config/        Zod-validated env parsing
problems/               Problem bank: one Kattis-format package per folder
scripts/                Stack health check, Piston runtime installer
```

## Prerequisites

- **Node.js 22+**, with pnpm through corepack: `npm i -g corepack@0.36.0` then `corepack enable pnpm`. The pnpm version is pinned in `package.json`. Node 22's bundled corepack is too old to download it.
- **Docker Desktop**, using the WSL2 backend on Windows.

## Setup (first time)

```sh
pnpm install                       # also generates the Prisma client
cp .env.example .env               # defaults work for local dev
docker compose up -d --build       # caddy, web, postgres, judge
node scripts/install-piston-runtimes.mjs   # once: installs C++ and Python into Piston
pnpm db:deploy                     # apply database migrations
pnpm stack:check                   # verify everything is up
```

Postgres is published on host port **5433**, not 5432, so it doesn't clash with a native Postgres install. Piston (`localhost:2000`) and Postgres are bound to localhost only.

## Running

| What                    | Command                                                  | URL                                   |
| ----------------------- | -------------------------------------------------------- | ------------------------------------- |
| Full stack in Docker    | `docker compose up -d --build`                           | http://localhost:8080                 |
| Web app with hot reload | `pnpm dev` (with `postgres` + `judge` running in Docker) | http://localhost:3000                 |
| Database browser        | `pnpm db:studio`                                         | printed in the terminal               |
| Share with friends      | `cloudflared tunnel --url http://localhost:8080`         | printed `https://….trycloudflare.com` |

Stop the stack with `docker compose down`. Add `-v` to also delete the database, Piston runtimes, and Caddy data.

## Testing

### Everything CI runs

```sh
pnpm format:check
pnpm turbo run lint typecheck test build
```

These need no Docker services.

### Unit tests (Vitest)

```sh
pnpm test                          # all packages
pnpm --filter @rr/db test          # one package
pnpm --filter @rr/db exec vitest   # watch mode
```

Pure logic is test-driven. Tests are written before the code, so a milestone's tests can be red until that milestone is done.

| Area                                     | Location                                  | Milestone |
| ---------------------------------------- | ----------------------------------------- | --------- |
| Problem-package importer                 | `packages/db/src/import-problems.test.ts` | M1        |
| Lobby/side rules, host migration         | `apps/server`                             | M3        |
| Checker / verdicts                       | `packages/judge-client`                   | M4        |
| ICPC + race scoring, end-early detection | `apps/server/src/scoring`                 | M5–M6     |

### Local stack

`pnpm stack:check` checks that all containers are up, Postgres accepts queries, Caddy serves the web app, and Piston compiles and runs a C++ and a Python sample program.

### Database and problem bank

```sh
docker compose up -d postgres
pnpm db:deploy                     # apply migrations
pnpm db:migrate                    # dev only: create a new migration after editing schema.prisma
```

The problem importer (`pnpm db:import`, plus `--dry-run`, which validates every package in `problems/` without a database and also runs in CI) is being built in M1. To check it end to end:

1. Import the problems and confirm the rows in `pnpm db:studio`.
2. Re-run the import and confirm there are no duplicates.
3. Break a `problem.yaml` and confirm `--dry-run` fails.

### End-to-end

Integration pieces (REST, Socket.IO, Liveblocks sync, the editor) are checked by hand in a browser as each milestone lands. A full manual smoke test, including over the Cloudflare tunnel, happens in M10.

## Adding a problem

Create `problems/<slug>/` with `problem.yaml`, `statement/problem.en.md`, `data/sample/*.in|.ans`, and `data/secret/*.in|.ans`. The exact rules the importer enforces (required fields, difficulty as a `difficulty:N` keyword, float tolerance, what's unsupported) are in [packages/db/fixtures/problems/README.md](packages/db/fixtures/problems/README.md). The fixtures in that folder are working examples.

## Troubleshooting

- **pnpm refuses a just-published package:** pnpm's `minimumReleaseAge` policy. Pin a slightly older version.
