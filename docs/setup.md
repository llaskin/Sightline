# Setup

Local development setup for the Sightline.

## Prerequisites

| Tool | Version used during development | Notes |
|---|---|---|
| Node.js | 25.6.1 | `package.json` requires `>=20.9.0`. The production container pins Node 22 LTS. |
| npm | 11.9.0 | Lockfile is committed; use `npm ci` for reproducible installs. |
| Docker | Docker Desktop with Compose v2 | Supplies PostgreSQL for development and tests. |
| PostgreSQL | 16.14 (`postgres:16-alpine`) | Started by `compose.yml`; no host install required. |

Release 1 needs **no Google credentials and no AI provider key**.

## First run

```bash
# 1. Install locked dependencies
npm ci

# 2. Start PostgreSQL (development, integration and browser databases on port 5433)
docker compose up -d

# 3. Configure environment
cp .env.example .env.local
# Then set a real secret:
#   openssl rand -base64 32
# and paste it into BETTER_AUTH_SECRET in .env.local

# 4. Apply database migrations
npm run db:migrate

# 5. Provision the first agency owner (no public signup exists)
npm run provision:user -- --email you@example.com --name "Your Name" \
  --workspace "Your Agency" --role owner

# 6. Start the application
npm run dev
```

The application listens on <http://localhost:3100>. Port 3100 is used rather than
3000 so it cannot collide with another local Next.js app.

**Stopping the database:** `docker compose down` stops the container and keeps the
data volume. `docker compose down -v` also destroys the data.

## Ports

| Port | Purpose |
|---|---|
| 3100 | `npm run dev` / `npm run start` |
| 3110 | Playwright's production server during `npm run test:e2e` |
| 5433 | PostgreSQL: `sightline` (development), `sightline_test` (integration), `sightline_e2e` (browser) |

## Environment variables

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Application database connection. |
| `TEST_DATABASE_URL` | integration tests only | Must name a database ending in `_test`. There is deliberately **no** fallback to `DATABASE_URL`. |
| `E2E_DATABASE_URL` | browser tests only | The database `npm run test:e2e` resets and reseeds. Kept separate from both of the above so a browser run cannot destroy development data or race the integration suite. |
| `BETTER_AUTH_SECRET` | yes | Session signing secret, minimum 32 characters. |
| `BETTER_AUTH_URL` | yes | Public base URL of the application. |
| `APP_ORIGIN` | yes | Origin permitted to send state-changing requests. |

## Verification commands

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run test:unit     # Pure domain, parser and formatting tests (no database)
npm run test:integration  # Real PostgreSQL against TEST_DATABASE_URL
npm run build         # Production build
npm run test:e2e      # Playwright browser + accessibility checks
```

`npm run test:e2e` needs a browser binary once: `npx playwright install chromium`.

It serves the output of the last `npm run build` rather than building for
itself, so **run `npm run build` first** after changing anything under `src/`.
Running the commands in the order listed above does this for you.

## Operator CLI

| Command | Purpose |
|---|---|
| `npm run provision:user -- --email … --name … --workspace … --role owner` | Create the first owner and their workspace. |
| `npm run provision:user -- --email … --name … --workspace-id … --role analyst` | Add an analyst to an existing workspace. |
| `npm run reset:password -- --email …` | Set a new password and revoke that user's sessions. |
| `npm run seed:demo -- --workspace-id …` | Load the fictional demo client into a development workspace. |
| `npm run maintenance -- --dry-run` | Report retention and expiry counts without deleting. |
| `npm run maintenance -- --apply` | Apply retention, draft expiry and idempotency cleanup. |

Passwords are read from a prompt or from the `NEW_PASSWORD` environment variable,
never from a command-line argument, so they stay out of shell history.

## Known dependency advisories

`npm audit` reports 4 moderate advisories, all reaching the tree through
`drizzle-kit -> @esbuild-kit/esm-loader -> esbuild`. This is a build-time CLI
dependency used only for generating and applying migrations; it is not part of
the application runtime or the production container. No fix is published for
`@esbuild-kit/*`, which is deprecated upstream.
