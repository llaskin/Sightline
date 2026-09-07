# SEO Client Excuse Detector

An agency application that compares a client's complaint against search,
website and lead evidence, identifies the most plausible area to investigate,
and drafts a respectful, editable response.

It is upload-first: you import two comparable reporting periods as documented
CSV files or through matching manual forms, and a versioned deterministic rules
engine produces an explainable result. Every figure on screen can be traced to
the rows it came from.

## What it deliberately does not do

This matters more than the feature list, because the interesting failure mode
for a tool like this is a confident wrong answer.

- **No validity percentage.** There is no "82% not valid" score anywhere. Two
  reporting periods cannot support a probability that a complaint is right, so
  the application reports which of four areas to investigate and how strong the
  supporting evidence is, in words.
- **No fabricated trends.** A metric with two summary values gets no sparkline.
  If no trend file was imported, the chart says "Trend data not provided"
  instead of drawing a line between two points.
- **No claim about received leads from analytics alone.** A tracked lead session
  is a session containing the configured lead action. It is not a lead that
  reached the client's inbox or CRM. A "we got no leads" complaint therefore
  stays **unverified** unless CRM or inbox evidence is supplied, even when the
  analysis is confident about where to look.
- **No cause.** The engine names an area to investigate. It never asserts a
  broken plugin, an HTTP status, a CRM error or a deployment, because aggregate
  data cannot identify one.
- **No blame.** Recommendations name a function to involve (SEO, web
  development, analytics, sales operations), never a person at fault.
- **No AI in release 1.** The diagnosis panel is labelled "Evidence diagnosis"
  and carries a "Rule generated" badge, because that is what produces it.

## Requirements

Node 20.9 or newer (developed on 25.6.1, production image pinned to Node 22
LTS), npm, and Docker for the local PostgreSQL. No Google credentials and no AI
provider key are needed.

## Quick start

```bash
npm ci
docker compose up -d                 # PostgreSQL 16 on port 5433
cp .env.example .env.local           # then set BETTER_AUTH_SECRET
npm run db:migrate

NEW_PASSWORD='choose-a-long-password' \
  npm run provision:user -- --email you@example.com --name "Your Name" \
    --workspace "Your Agency" --role owner

npm run dev                          # http://localhost:3100
```

Sign in, add a client, then either import the CSV templates from the import
wizard or open <http://localhost:3100/demo> to see a worked example first.

Stop the database with `docker compose down` (add `-v` to destroy the data).

Full detail: [docs/setup.md](docs/setup.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/setup.md](docs/setup.md) | Prerequisites, first run, ports, environment, operator CLI |
| [docs/data-imports.md](docs/data-imports.md) | The five CSV templates, what a traffic report can and cannot tell you, limits |
| [docs/deployment.md](docs/deployment.md) | Release sequence, TLS, rate limiting, health checks, retention, backups |
| [docs/verification.md](docs/verification.md) | Recorded test results and the acceptance matrix |
| [docs/superpowers/specs/](docs/superpowers/specs/) | The product and technical specification |

## How it fits together

```
CSV or manual entry
  -> validated and normalised
  -> immutable report snapshot        (never edited; a correction is a new row)
                                 \
structured complaint  ------------ -> pure analysis engine
                                 /        |
                                          v
                                  immutable analysis snapshot
                                    |          |          |
                              dashboard   template     authenticated
                                          renderer      exports
                                             |
                                    editable response revisions
```

The domain package under `src/domain/` has no database, framework, network,
environment-variable or model dependency. It is the same code that runs on the
public demo and in an authenticated workspace, which is why the demo is a fair
demonstration rather than a mock-up.

Reports and analyses are immutable once written. Reading an old analysis returns
exactly what was stored, so upgrading the rules never silently rewrites history.

## Verification

```bash
npm run lint
npm run typecheck
npm run test:unit          # domain, parsing, formatting; no database, no network
npm run test:integration   # real PostgreSQL, isolated *_test database
npm run build
npm run test:e2e           # browser and accessibility (needs: npx playwright install chromium)
```

## Roles

| Capability | Owner | Analyst |
|---|---|---|
| View clients, reports and analyses | yes | yes |
| Create clients, import reports, record complaints, create analyses | yes | yes |
| Edit response drafts, copy, export | yes | yes |
| Edit templates, workspace name, retention | yes | no |
| Archive a client; permanently delete a client | yes | no |
| Create and deactivate users | operator CLI | no |

There is no public sign-up and no self-service password recovery in this
release. An operator provisions accounts through the CLI.

## Deferred to later phases

GA4 and Search Console connectors, rank-tracker adapters, form and delivery
monitoring integrations, an optional constrained AI narrative, invitations,
scheduled refresh, CRM and call tracking, client portals, PDF reports, billing
and email sending. Each has its own entry criteria in the specification. None is
present as a disabled button pretending to exist.
