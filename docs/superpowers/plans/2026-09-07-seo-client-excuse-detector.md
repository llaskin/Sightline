# Sightline Implementation Plan

> **For agentic workers:** Use the available `executing-plans` skill to implement this plan task by task. If the user authorizes agent delegation, `subagent-driven-development` is an alternative. Steps use checkbox syntax for tracking. This document requests future implementation; it does not authorize this documentation session to build or deploy the application.

**Goal:** Deliver a working upload-first agency app that reproduces the supplied dashboard's visual structure, analyzes actual report data, explains its findings, and saves editable client responses.

**Architecture:** One Next.js application with a PostgreSQL database. CSV/manual inputs become immutable normalized report snapshots; a pure, versioned TypeScript rules engine produces immutable analyses, and a template renderer creates versioned response drafts. All persistent reads and writes are scoped to a server-verified agency membership.

**Tech stack:** TypeScript, Next.js App Router, React, Tailwind CSS, accessible Radix-based controls, Lucide, Recharts, Zod, Drizzle/PostgreSQL, Better Auth, Vitest, Playwright, axe, npm, Docker Compose.

**Authoritative specification:** [Product and technical specification](../specs/2026-09-07-sightline-design.md). This plan builds release 1 only; direct Google APIs, AI narrative, billing, emails and arbitrary PDF parsing are separate phases.

**Visual reference:** a user-supplied dashboard screenshot, held privately and not distributed with this repository. It was a reference asset, never content to ship as the app UI.

---

## How to use this handoff

The starting directory was empty and was not a Git repository when this handoff was written. All paths below are proposed new files relative to the application root. Before implementing, inspect the actual directory again, preserve any intervening user work, and read applicable `AGENTS.md` instructions. Do not treat the listed stack as a claim about the Reddit author's implementation.

Implement a task, verify its stated contract, and make a focused commit before moving on if a repository is available. If still starting from an empty directory, initialize local Git as a normal implementation step; publishing a repository or deploying is a separate user decision. Use a worktree if an existing repository needs isolation. Do not install dependencies or scaffold anything merely to read this plan.

Use the spec's defaults unless the user changes them. Do not stop execution repeatedly to choose colors, component names, or provider versions; resolve compatible stable dependencies once, pin them, and record the choice. Google/model credentials must not be required to run release 1. This is a substantial application, so complete it in the milestones below and report working behavior at each milestone; a visual mockup alone is not completion.

Code snippets below lock down core contracts and numerical behavior. UI/service implementation must satisfy the accompanying concrete requirements and tests; snippets are not represented as an already compiled application. Tests should cover meaningful outcomes and failure boundaries, rather than merely mirror implementation details.

## Milestones and dependency order

| Milestone | Tasks | Observable completion |
|---|---|---|
| A — Domain foundation | 1–6 | Exact sample and adverse scenarios analyze correctly, without any external service |
| B — Persistent workflow | 7–11 | Authenticated clients, imports, complaints, analyses, responses and exports survive restart |
| C — Recreated product | 12–15 | All screenshot-inspired screens operate against persisted data; responsive demo works |
| D — Release verification | 16–18 | Isolation/security/retention/browser checks, deployment package and operator handoff |

Tasks 1–6 precede dashboard work so the interface displays trustworthy values. There is no instruction to dispatch subagents; execute sequentially unless the user has separately authorized delegation.

## Proposed file map

```text
src/
  app/
    (auth)/login/page.tsx
    (app)/layout.tsx
    (app)/dashboard/page.tsx
    (app)/analyses/new/page.tsx
    (app)/analyses/[analysisId]/page.tsx
    (app)/reports/new/page.tsx
    (app)/reports/[reportId]/page.tsx
    (app)/complaints/page.tsx
    (app)/history/page.tsx
    (app)/clients/page.tsx
    (app)/clients/[clientId]/page.tsx
    (app)/templates/page.tsx
    (app)/settings/page.tsx
    demo/page.tsx
    api/                         # Exact handlers listed in tasks 7–11 and 16
    layout.tsx
    globals.css
  domain/
    report-schema.ts             # Dataset and metadata runtime schemas
    complaint-schema.ts          # Categories, scope and complaint validation
    analysis-schema.ts           # Result types and runtime validation
    metrics.ts                   # Changes, rates, rank movement
    comparability.ts             # Dates, scopes, coverage, definitions
    signals.ts                   # Thresholds and eligibility
    assess-complaint.ts           # Direct outcome evidence
    analyze.ts                   # Ordered diagnosis rules
    recommendations.ts           # Evidence-linked next checks
    render-response.ts           # Restricted token rendering + mandatory caveats
    fixtures/demo-report.ts      # Fictional normalized inputs
    fixtures/demo-complaint.ts
  features/
    imports/csv.ts               # Bounded CSV parsing only
    imports/normalize.ts         # Snake_case to canonical objects
    imports/templates.ts         # Generated sample CSV and column guidance
    imports/import-wizard.tsx
    imports/manual-entry.tsx
    imports/validation-preview.tsx
    dashboard/dashboard.tsx
    dashboard/view-model.ts
    dashboard/assessment-card.tsx
    dashboard/metric-card.tsx
    dashboard/traffic-chart.tsx
    dashboard/pages-table.tsx
    dashboard/keywords-table.tsx
    dashboard/diagnosis-card.tsx
    dashboard/evidence-drawer.tsx
    responses/response-editor.tsx
    clients/client-form.tsx
    complaints/complaint-form.tsx
    history/history-table.tsx
  components/
    app-shell.tsx
    navigation.tsx
    ui/                          # Focused accessible controls, empty/error states
  server/
    env.ts
    auth.ts
    require-membership.ts
    http.ts                      # Envelopes, error mapping, origin checks
    db/client.ts
    db/schema/auth.ts
    db/schema/workspaces.ts
    db/schema/clients.ts
    db/schema/complaints.ts
    db/schema/reports.ts
    db/schema/analyses.ts
    db/schema/responses.ts
    db/schema/audit.ts
    repositories/clients.ts
    repositories/complaints.ts
    repositories/imports.ts
    repositories/reports.ts
    repositories/analyses.ts
    repositories/responses.ts
    repositories/templates.ts
    repositories/settings.ts
    services/commit-import.ts
    services/create-analysis.ts
    services/retention.ts
    services/delete-client.ts
    exports/markdown.ts
    exports/csv.ts
    idempotency.ts
  lib/format.ts
tests/
  unit/                          # Named in individual tasks
  integration/                   # Real isolated PostgreSQL tests
  e2e/                           # Browser workflow and accessibility tests
  fixtures/                      # Small valid/invalid CSV and report fixtures
  helpers/database.ts
  helpers/auth.ts
scripts/
  provision-user.ts
  reset-password.ts
  seed-demo.ts
  maintenance.ts
drizzle/                         # Generated, reviewed SQL migrations
public/templates/                # Materialized downloadable templates
docs/setup.md
docs/data-imports.md
docs/deployment.md
docs/verification.md
.env.example
.github/workflows/ci.yml
compose.yml
Dockerfile
package.json
```

Do not make domain files import server/UI modules. Route handlers remain thin: membership, parse/validate, call scoped repository/service, return envelope. Prefer module-scoped names to an all-purpose `utils.ts` or a monolithic dashboard component.

## Task 1: Bootstrap and establish verification commands

**Create:** `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `.env.example`, `compose.yml`, `.gitignore`, `docs/setup.md`.

- [ ] Inspect current files and Git state, then scaffold Next.js App Router with TypeScript, `src/`, Tailwind and ESLint. Use a temporary empty scaffold directory if a scaffold command rejects the existing `docs/`; merge generated files while preserving both handoff documents. Resolve dependencies from current official docs and commit a lockfile.
- [ ] Install compatible Drizzle, PostgreSQL driver, Better Auth, Zod, Recharts, Lucide, CSV parser, Radix controls, Vitest, Playwright, axe and TypeScript runner dependencies. Use an established CSV parser; do not implement quoting by splitting on commas.
- [ ] Define the following script contract. Test configurations must separate unit and integration suites. The destructive integration setup must assert that its database name ends in `_test` and never use `DATABASE_URL` as a fallback for `TEST_DATABASE_URL`.

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test:unit": "vitest run --project unit",
  "test:integration": "vitest run --project integration",
  "test:e2e": "playwright test",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "provision:user": "tsx scripts/provision-user.ts",
  "reset:password": "tsx scripts/reset-password.ts",
  "seed:demo": "tsx scripts/seed-demo.ts",
  "maintenance": "tsx scripts/maintenance.ts"
}
```

- [ ] Configure persistent local PostgreSQL in Compose, named local development volume, and an explicitly separate test database. Document chosen Node/database versions. `.env.example` contains names and nonsecret example values only: `DATABASE_URL`, `TEST_DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ORIGIN`.
- [ ] Run `npm run lint`, `npm run typecheck`, and `npm run build`. Expected: each exits 0 for the scaffold; no secret/database access during public static demo build. Record setup prerequisites and commands in `docs/setup.md`.
- [ ] Commit the foundation with message `chore: scaffold agency analysis application`.

## Task 2: Define canonical schemas and comparability

**Create:** `src/domain/report-schema.ts`, `src/domain/complaint-schema.ts`, `src/domain/analysis-schema.ts`, `src/domain/comparability.ts`, `tests/unit/report-schema.test.ts`, `tests/unit/comparability.test.ts`.

- [ ] Define Zod schemas for every metadata, dataset and outcome field in spec §5, and export inferred types `NormalizedReport`, `ComplaintInput`, and `AnalysisResult`. Use `schemaVersion: 1`, finite safe integer counts, nullable unknowns, enums, size bounds and explicit source metadata per period/dataset.
- [ ] Define `validateComparability(report, now)` returning `{ baseEligible, datasetFlags, gaps, measurementIssue }`. Inject `now`; never read the wall clock inside a pure function. Compute calendar day differences in the report's IANA timezone, not by assuming every local day is 24 hours.
- [ ] Test the constraints below as separate cases before implementing their validation. Explicitly distinguish rejected structure from accepted-but-ineligible evidence.

| Fixture | Expected |
|---|---|
| Two 28-day complete adjacent windows | Valid |
| Equal day counts across DST | Valid; correct calendar duration |
| Overlap, current incomplete day, 6 or 94 days, unequal windows | Reject with named date fields |
| leadSessions > sessions; fractional/negative counts; Infinity | Reject |
| Missing leadSessions with known sessions | Valid null; conversion ineligible |
| Partial optional forms but complete organic data | Commit allowed; only form signal ineligible |
| Organic period definitions/timezones differ | Measurement issue; values retained |
| GSC optional evidence uses PT and organic uses New York | Context with timezone caveat; do not relabel dates |

- [ ] Implement schemas and comparability output; keep wire date strings and parsed dates unambiguous. Add the complaint period-match test with exact ISO date equality.
- [ ] Run `npm run test:unit -- tests/unit/report-schema.test.ts tests/unit/comparability.test.ts`. Expected: all cases pass with actionable field errors. Commit `feat: define canonical report and comparison contracts`.

## Task 3: Implement metrics with reproducible arithmetic

**Create:** `src/domain/metrics.ts`, `src/lib/format.ts`, `tests/unit/metrics.test.ts`, `tests/unit/format.test.ts`.

- [ ] Add explicit exported functions `relativeChange(current, baseline)`, `rate(numerator, denominator)`, `percentagePointChange(currentRate, baselineRate)`, `compareKeywordCohort(rows, sources)` and `compareSelectedForm(rows, selectedFormId, sources)`. Inputs and outputs use schema types and spec §6 semantics.
- [ ] Start with these executable tests; add threshold-boundary, missing-cohort and unranked-transition cases specified below.

```ts
import { describe, expect, it } from 'vitest';
import { relativeChange, rate, percentagePointChange } from '@/domain/metrics';

describe('metric arithmetic', () => {
  it('calculates change from exact counts', () => {
    const traffic = relativeChange(12540, 7210);
    expect(traffic.kind).toBe('relative');
    if (traffic.kind === 'relative') expect(traffic.percent).toBeCloseTo(73.925104, 5);
    const before = rate(151, 7210);
    const after = rate(150, 12540);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    const conversion = relativeChange(after, before);
    expect(conversion.kind).toBe('relative');
    if (conversion.kind === 'relative') {
      expect(conversion.percent).toBeCloseTo(-42.884756, 5);
    }
    expect(percentagePointChange(after, before)).toBeCloseTo(-0.898141, 5);
  });
  it('preserves zero and unknown as distinct states', () => {
    expect(relativeChange(5, 0)).toEqual({ kind: 'new', absolute: 5 });
    expect(relativeChange(0, 0)).toEqual({ kind: 'no_activity', absolute: 0 });
    expect(relativeChange(0, 10)).toEqual({ kind: 'relative', percent: -100, absolute: -10 });
    expect(relativeChange(null, 10).kind).toBe('unavailable');
    expect(rate(0, 0)).toBeNull();
    expect(rate(null, 100)).toBeNull();
  });
});
```

- [ ] Implement the primitives with the following contract, guarding any broader untrusted values at the schema boundary:

```ts
import type { Change } from './analysis-schema';

export function relativeChange(current: number | null, baseline: number | null): Change {
  if (current === null || baseline === null) {
    return { kind: 'unavailable', reason: 'A comparison value was not provided' };
  }
  const absolute = current - baseline;
  if (baseline === 0) {
    return current === 0
      ? { kind: 'no_activity', absolute: 0 }
      : { kind: 'new', absolute };
  }
  return { kind: 'relative', percent: (absolute / baseline) * 100, absolute };
}

export function rate(numerator: number | null, denominator: number | null): number | null {
  return numerator === null || denominator === null || denominator === 0
    ? null : numerator / denominator;
}

export function percentagePointChange(current: number | null, baseline: number | null): number | null {
  return current === null || baseline === null ? null : (current - baseline) * 100;
}
```

- [ ] Implement cohort intersection, exact source/device/location/intent matching and explicit unranked handling. Test 10 entries plus 3 exits => net +7; missing row is excluded, blank present rank is unranked; GSC never becomes rank-tracker evidence; case-normalized duplicate keys reject.
- [ ] Implement form rates and raw count multiple separately. Test 5/100 ->15/300 yields unchanged failure rate while raw error events rise 3x. Test baseline zero failures against the spec's absolute thresholds.
- [ ] Implement display formatting separately from decision math. Test whole percentage −42.884755... => −43%, rates 2.1%/1.2%, percentage points −0.90 pp, null => Not provided, and no NaN/Infinity output.
- [ ] Run `npm run test:unit -- tests/unit/metrics.test.ts tests/unit/format.test.ts`. Expected: all cases pass. Commit `feat: calculate evidence metrics without fabricated precision`.

## Task 4: Build the fictional dataset and CSV import pipeline

**Create:** `src/domain/fixtures/demo-report.ts`, `src/domain/fixtures/demo-complaint.ts`, `src/features/imports/csv.ts`, `src/features/imports/normalize.ts`, `src/features/imports/templates.ts`, `public/templates/organic-summary.csv`, `public/templates/keywords.csv`, `public/templates/forms.csv`, `public/templates/landing-pages.csv`, `public/templates/traffic-trend.csv`, `tests/unit/imports.test.ts`, `tests/fixtures/imports/`, `docs/data-imports.md`.

- [ ] Export `makeDemoReport(): NormalizedReport` and `makeDemoComplaint(): ComplaintInput`. Return fresh objects on every call; use the exact counts, dates, 100-member rank cohort and six trend buckets in spec §11. Export a fixed `DEMO_NOW = '2026-08-11T12:00:00Z'` for deterministic tests and historical demo presentation.
- [ ] Define `parseDatasetCsv(dataset, input, limits)` -> canonical rows plus structured row errors and byte/row counts. Define `normalizeDraft(metadata, datasets)` -> validated report candidate. Files and manual input both call the same normalization path.
- [ ] Write fixtures for BOM, quoted commas/newlines, blank optional numbers, duplicate headers, unknown columns, bad encoding, embedded HTML, formula-prefixed cells, row/cell/byte overflow, duplicate keyword keys and malformed quoting. Assert exact acceptance/rejection and error field/row positions. Generate oversized content in tests without committing huge fixtures.
- [ ] Implement streaming limits and parser error conversion. Do not keep uploaded bytes after normalization. Hash original input while reading; retain sanitized name/hash/source metadata, not the original body. Validation caps returned errors at 100 with total count.
- [ ] Implement downloadable templates and document that provider CSVs require conversion into these headers. Include source-selection guidance and explain why form failures and received leads cannot be inferred from a standard organic traffic report.
- [ ] Validate trend intervals, date-ordering, no overlap, safe counts and honest period aggregates. When a trend bucket exactly matches a summary period, require sessions to agree and any known active-users totals to agree; mismatches become explicit validation errors rather than conflicting dashboard values.
- [ ] Run `npm run test:unit -- tests/unit/imports.test.ts`. Expected: demo templates round-trip through schema normalization and all hostile/ambiguous inputs behave as specified. Commit `feat: add validated CSV imports and fictional demo data`.

## Task 5: Implement explainable diagnosis and outcome assessment

**Create:** `src/domain/signals.ts`, `src/domain/assess-complaint.ts`, `src/domain/analyze.ts`, `src/domain/recommendations.ts`, `tests/unit/analysis.test.ts`, `tests/unit/complaint-assessment.test.ts`.

- [ ] Define `deriveSignals(report, quality)` and `assessComplaint(report, complaint)` using exact eligibility and threshold boundaries in spec §7. Keep data-quality reasons on each signal. Define `analyzeReport(report, complaint, { now, ruleVersion: '1.0.0' })` -> `AnalysisResult`.
- [ ] Add this regression test, then build the acceptance fixture matrix. Do not satisfy the test by recognizing demo IDs or returning prewritten results.

```ts
import { expect, it } from 'vitest';
import { analyzeReport } from '@/domain/analyze';
import { makeDemoReport, DEMO_NOW } from '@/domain/fixtures/demo-report';
import { makeDemoComplaint } from '@/domain/fixtures/demo-complaint';

it('keeps a suspected post-click issue separate from proof of received leads', () => {
  const result = analyzeReport(makeDemoReport(), makeDemoComplaint(), {
    now: new Date(DEMO_NOW), ruleVersion: '1.0.0'
  });
  expect(result.diagnosis).toBe('post_click');
  expect(result.complaintAssessment).toBe('unverified');
  expect(result.evidenceStrength).toBe('moderate');
  expect(result.findings.every(finding => finding.sources.length > 0)).toBe(true);
  expect(result.nextChecks.every(check => check.findingIds.length > 0)).toBe(true);
  expect(result).not.toHaveProperty('validityPercent');
});
```

- [ ] Implement diagnosis as the ordered table below; no LLM or random score participates:

```ts
export function chooseDiagnosis(signals: {
  measurementIssue: boolean;
  baseEligible: boolean;
  acquisitionConcern: boolean;
  postClickConcern: boolean;
}): 'measurement_issue' | 'insufficient_evidence' | 'mixed'
  | 'search_acquisition' | 'post_click' | 'no_clear_issue' {
  if (signals.measurementIssue) return 'measurement_issue';
  if (!signals.baseEligible) return 'insufficient_evidence';
  if (signals.acquisitionConcern && signals.postClickConcern) return 'mixed';
  if (signals.acquisitionConcern) return 'search_acquisition';
  if (signals.postClickConcern) return 'post_click';
  return 'no_clear_issue';
}
```

- [ ] Test AC-02 through AC-12 and AC-22 through AC-24, with explicit boundaries at 99/100 sessions, 19/20 baseline lead sessions, −9.999/−10% traffic, −19.999/−20% conversion, 19/20 keywords, net −4/−5, form +1.999/+2 pp and +49.999/+50%. Classification must use unrounded values.
- [ ] Test unverified tracking limits strength; independent organic form backend can raise strength; two GA4 metrics cannot; all-channel forms cannot. Ensure a known GA4 tracking issue does not invalidate independent confirmed CRM zero leads.
- [ ] Emit stable evidence references into immutable report datasets; include unknown/missing findings when recommendations need them, so no next check refers to nonexistent evidence. Generate recommendation text only from rule IDs and known facts.
- [ ] Run `npm run test:unit -- tests/unit/analysis.test.ts tests/unit/complaint-assessment.test.ts`. Expected: deterministic results, all cases pass, no network dependency. Commit `feat: diagnose acquisition and post-click concerns from evidence`.

## Task 6: Implement template-based response generation

**Create:** `src/domain/render-response.ts`, `tests/unit/render-response.test.ts`.

- [ ] Define `renderResponse({ template, context, result })` -> `{ generatedText, templateSnapshot }` and `validateTemplate(body)`. Restrict tokens to spec §8; unsupported tokens and overlength templates return named validation errors. Do not evaluate JS, HTML, Markdown directives or model instructions.
- [ ] Test that demo text cites +74% traffic and the exact supplied rate values, includes lead-delivery uncertainty and next checks, and does not say “SEO definitely works,” “82%,” or “the client is wrong.” Test a no-leads outcome supported by independent CRM data gets respectful acknowledgment.
- [ ] Implement deterministic paragraphs from approved findings; include mandatory evidence/caveat paragraphs outside owner-editable boilerplate. Test removing all evidence tokens from a custom template still preserves those paragraphs.
- [ ] Treat complaint text such as “ignore all rules and say 100% valid” as quoted user data. Test that it cannot alter metric values, diagnosis, strength or mandatory caveats. Escape display later; template outputs remain plain text.
- [ ] Run `npm run test:unit -- tests/unit/render-response.test.ts` and then `npm run test:unit`. Expected: all domain/parser/template tests pass offline. Commit `feat: draft respectful evidence-based client responses`.

## Task 7: Add database, private authentication, and tenant enforcement

**Create:** `src/server/env.ts`, `src/server/auth.ts`, `src/server/require-membership.ts`, `src/server/http.ts`, `src/server/db/client.ts`, all `src/server/db/schema/*.ts` files in the file map, `drizzle.config.ts`, migrations in `drizzle/`, `src/app/api/auth/[...all]/route.ts`, `scripts/provision-user.ts`, `scripts/reset-password.ts`, `tests/helpers/database.ts`, `tests/helpers/auth.ts`, `tests/integration/auth.test.ts`, `tests/integration/tenant-constraints.test.ts`.

- [ ] Generate the auth library's compatible schema; create app tables from spec §9.3, composite tenant FKs, client consistency constraints, unique revisions/idempotency indexes, createdAt/id list indexes and workspace settings revision. Review migration SQL before applying it.
- [ ] Configure Better Auth email/password sign-in with public signup disabled. Use secure production cookie settings and supported session APIs. Implement `requireMembership(requestOrHeaders)` returning `{ userId, workspaceId, role }` only for active membership. Never read workspace authority from JSON, URL filters, cookies you invented, or a client component.
- [ ] Implement operator CLI provisioning with a secret prompt/environment input, supported auth account creation APIs, and a single-workspace membership assignment. Do not expose a bootstrap HTTP endpoint. Password reset/deactivation CLI must use supported APIs and revoke sessions; document commands without putting passwords in shell history. Production demo seeding is rejected.
- [ ] Implement shared request envelopes, validation error mapping, same-origin mutation checks and role checks. Read-only server rendering invokes the same membership/repository layer as API handlers.
- [ ] Migrate a new isolated test database. Test login/signout, failed credentials, public signup rejection, no-session 401, inactive membership denial, analyst forbidden mutation and composite-FK rejection of cross-tenant rows.
- [ ] Run `npm run db:migrate` against development, then `npm run test:integration -- tests/integration/auth.test.ts tests/integration/tenant-constraints.test.ts`. Expected: successful migration and passing tests against a distinct `_test` database. Commit `feat: add private agency authentication and tenant persistence`.

## Task 8: Implement clients, complaints, templates and settings services

**Create:** `src/server/repositories/clients.ts`, `src/server/repositories/complaints.ts`, `src/server/repositories/templates.ts`, `src/server/repositories/settings.ts`, `src/app/api/clients/route.ts`, `src/app/api/clients/[id]/route.ts`, `src/app/api/complaints/route.ts`, `src/app/api/complaints/[id]/route.ts`, `src/app/api/templates/route.ts`, `src/app/api/templates/[id]/route.ts`, `src/app/api/settings/route.ts`, `tests/integration/client-workflow.test.ts`.

- [ ] Implement every endpoint's input/output/status contract from spec §9.5. Validate names/domain/timezone/definitions; store domain without fetching it. Return keyset pagination with client/status/category filters, never all workspace data in a single response.
- [ ] Add optimistic revisions to mutable clients/complaints/templates/settings. In SQL, update only `WHERE workspaceId = session.workspaceId AND id = id AND revision = expectedRevision`, increment revision and return the row. Distinguish unknown ID 404 from valid-but-stale 409 after a scoped existence check.
- [ ] Implement archive/restore and complaint open/analyzed/resolved transitions. Reject new imports/complaints/analyses on archived clients with 409 and `CLIENT_ARCHIVED`.
- [ ] Provision a bundled default response template for each workspace; ensure first analysis can always use it. Editing templates cannot mutate prior response template snapshots. Owner-only settings/templating writes return 403 for analysts.
- [ ] Test create/read/update, concurrent revision conflict, archived-client restrictions, period validation, unknown tokens, pagination and cross-client complaint association. Test arbitrary foreign workspace IDs return 404 across detail/PATCH routes.
- [ ] Run `npm run test:integration -- tests/integration/client-workflow.test.ts`. Expected: all cases pass. Commit `feat: manage agency clients complaints and templates`.

## Task 9: Persist imports and immutable reports

**Create:** `src/server/repositories/imports.ts`, `src/server/repositories/reports.ts`, `src/server/services/commit-import.ts`, `src/server/idempotency.ts`, `src/app/api/imports/route.ts`, `src/app/api/imports/[id]/route.ts`, `src/app/api/imports/[id]/files/route.ts`, `src/app/api/imports/[id]/validate/route.ts`, `src/app/api/imports/[id]/commit/route.ts`, `src/app/api/reports/route.ts`, `src/app/api/reports/[id]/route.ts`, `tests/integration/import-commit.test.ts`.

- [ ] Implement draft create/get/patch/delete and upload. Apply byte limits before full body buffering; use a bounded multipart reader or a reverse proxy body cap plus a streaming handler limit. A `Content-Length` check alone is insufficient because chunked requests may omit it.
- [ ] Persist normalized draft payload and source hashes; every change increments revision and resets state to draft. Validation records the full canonical content hash and revision, with explicit datasets/gaps. Missing optional data is permitted.
- [ ] Implement commit in one transaction: active client check, locked draft read, revision/hash match, idempotency check, immutable report insert, draft committed state, audit event, idempotency result. A correction checks the predecessor belongs to the same client/workspace.
- [ ] Define shared idempotency behavior: key is required on commit/create-analysis, scoped by operation/workspace; hash canonical request input; same key/same hash replays; same key/different hash 409. Unique database constraint and transaction handle concurrent first requests. Rollback leaves no committed report or successful key record.
- [ ] Test double click, parallel same-key commits, same-key/different-body, stale hash after edit, parse failure, database insert failure, foreign client draft, expired draft, and correction preserving original data.
- [ ] Run `npm run test:integration -- tests/integration/import-commit.test.ts`. Expected: one report under retries/concurrency and no partial persistence on failures. Commit `feat: commit validated report snapshots atomically`.

## Task 10: Persist analyses and response revisions

**Create:** `src/server/repositories/analyses.ts`, `src/server/repositories/responses.ts`, `src/server/services/create-analysis.ts`, `src/app/api/analyses/route.ts`, `src/app/api/analyses/[id]/route.ts`, `src/app/api/analyses/[id]/response/route.ts`, `src/app/api/analyses/[id]/response/regenerate/route.ts`, `tests/integration/analysis-workflow.test.ts`, `tests/integration/response-revisions.test.ts`.

- [ ] Implement `createAnalysis(context, input, requestKey)` with scoped report/complaint fetches, same-client validation and archived check. Run the domain engine and renderer from snapshots, then atomically save analysis, first response revision, complaint status transition, audit event and idempotency result.
- [ ] Avoid holding a transaction across external calls; release 1 has none. Snapshot complaint text/category/dates and all result versions. Add optional predecessor analysis link for reanalysis; it must belong to the same client/workspace.
- [ ] Implement history filters by client/date/diagnosis and keyset pagination. Detail reads return saved result plus latest response; do not recompute historical results on GET.
- [ ] Implement draft edit/regeneration under expected revision using a lock or equivalent transactional compare-and-set. Enforce unique `(analysisId, revision)` and append a new revision. Validate template scope; preserve generated text separately from edits.
- [ ] Test restart/reload persistence, changed complaint/template leaving old snapshots untouched, future rule version not rewriting old result, retry creating one analysis, mismatched client IDs rejecting, and parallel response saves producing one success and one 409.
- [ ] Run `npm run test:integration -- tests/integration/analysis-workflow.test.ts tests/integration/response-revisions.test.ts`. Expected: complete atomic creation and immutable history. Commit `feat: persist reproducible analyses and response revisions`.

## Task 11: Add safe exports and evidence view models

**Create:** `src/server/exports/markdown.ts`, `src/server/exports/csv.ts`, `src/features/dashboard/view-model.ts`, `src/app/api/analyses/[id]/export/route.ts`, `src/app/api/reports/[id]/export/route.ts`, `tests/unit/exports.test.ts`, `tests/unit/dashboard-view-model.test.ts`, `tests/integration/export-access.test.ts`.

- [ ] Implement `buildDashboardViewModel(report, complaintSnapshot, result, response)` as a pure mapping with no fresh analysis. Include exact dates, metric units, eligibility, evidence references, editable/generated labels, top-five subsets and real optional trend rows.
- [ ] Render Markdown with spec §8 fields, escape embedded Markdown/HTML appropriately, and clearly label the saved edited response as edited. CSV export must support quoting/newlines and neutralize spreadsheet formula prefixes, including leading whitespace/control characters before `=`, `+`, `-`, or `@` in text cells. Numeric columns serialize validated numbers as numbers.
- [ ] Apply membership and source relationship checks before constructing an export. Set attachment filename from safe fixed names/IDs, private/no-store caching, correct MIME type, and prevent path-derived filenames.
- [ ] Test export of a complaint containing HTML, backticks and formula strings; source evidence completeness; no trend => null chart series; dates sorted chronologically; pages labeled subset; unknown rank vs unranked; cross-workspace report/analysis export denied.
- [ ] Run `npm run test:unit -- tests/unit/exports.test.ts tests/unit/dashboard-view-model.test.ts` and `npm run test:integration -- tests/integration/export-access.test.ts`. Expected: safe output and evidence preserved. Commit `feat: expose traceable dashboard data and safe exports`.

## Task 12: Recreate the app shell and dashboard

**Create:** `src/components/app-shell.tsx`, `src/components/navigation.tsx`, accessible controls under `src/components/ui/`, `src/features/dashboard/dashboard.tsx`, `assessment-card.tsx`, `metric-card.tsx`, `traffic-chart.tsx`, `pages-table.tsx`, `keywords-table.tsx`, `diagnosis-card.tsx`, `evidence-drawer.tsx` in that directory; `src/app/(app)/layout.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/analyses/[analysisId]/page.tsx`, `src/app/demo/page.tsx`.  
**Modify:** `src/app/globals.css`.

- [ ] Establish screenshot-derived tokens, spacing and responsive grids from spec §4. Recreate the sidebar, dense left/right panel arrangement, typography, purple actions, colored metric deltas, burgundy complaint and bordered response area. Use new iconography and fictional profile information.
- [ ] Implement the investigation-focus graphic using SVG/CSS with an accessible text description and four labeled categories. Position by diagnosis, never a percentage. Mixed/unclear and measurement states must be visually distinct and text-identifiable.
- [ ] Wire dashboard components to the typed view model. All numeric text comes from formatting helpers; no duplicate calculations in JSX. Evidence buttons open a keyboard-accessible drawer containing sources, formulas, comparison details and caveats.
- [ ] Implement actual chart series, tooltip formatting, date selectors, series toggles and data-table alternative. Null/missing intervals remain gaps; unavailable range options are disabled; missing trend never becomes synthetic points.
- [ ] Implement full page/keyword table view within report details or a route-linked dialog; sorting and pagination must work. Clarify net rank gains, entered/exited, GSC-average labels and page subsets.
- [ ] Use the real analysis engine and fixed demo input for `/demo`; no login or write endpoints. Real dashboard renders the server-scoped saved analysis; no-data state links to adding a client or starting an import.
- [ ] Verify at 1536×1024, 1280×800, 1024×768, 768×1024 and 390×844 using screenshots. Check hierarchy against the user image; changed wording/gauge and corrected figures are intentional. Confirm natural scrolling and no hidden lower panels or body-wide horizontal overflow.
- [ ] Run `npm run typecheck` and `npm run build`. Expected: success. Commit `feat: recreate the evidence dashboard and responsive shell`.

## Task 13: Build sign-in, clients and report-import UI

**Create:** `src/app/(auth)/login/page.tsx`, `src/features/clients/client-form.tsx`, `src/app/(app)/clients/page.tsx`, `src/app/(app)/clients/[clientId]/page.tsx`, `src/features/imports/import-wizard.tsx`, `src/features/imports/manual-entry.tsx`, `src/features/imports/validation-preview.tsx`, `src/app/(app)/reports/new/page.tsx`, `src/app/(app)/reports/[reportId]/page.tsx`, `tests/e2e/import-workflow.spec.ts`.

- [ ] Implement login without public signup; retain return URL only if it is a validated same-origin app path. Provide generic credentials error and expired-session handling. Logout invalidates the session and clears private UI state.
- [ ] Build client create/edit, archive/restore and source-definition forms with error summaries and saved revision handling. Client detail lists reports and complaints. Owner deletion UI is wired in task 16, and until then must not claim deletion succeeded.
- [ ] Build the import wizard in order: client/periods/definitions, required organic dataset, optional evidence, validation preview, commit. Show dataset provenance and missing-evidence warnings. Manual entry and CSV must produce identical canonical values.
- [ ] Add template downloads, row/field errors, bounded upload progress, draft-save feedback, explicit reset, resume saved draft, and commit revision/hash. Keep the submit idempotency key stable while retrying one user action; use a new key for a genuinely new action.
- [ ] Commit only after server validation succeeds; after commit navigate to the report with “Create analysis.” A correction creates a new draft with predecessor link and preserved original metadata for review.
- [ ] Write a browser test that signs in, creates a client, downloads a template, imports demo CSV, corrects a deliberate field error, commits and reloads the report. Assert raw totals, date windows and source labels persist.
- [ ] Run `npm run test:e2e -- tests/e2e/import-workflow.spec.ts`. Expected: full browser workflow succeeds against the test app/database, with no mocked persistence. Commit `feat: add authenticated client and report workflows`.

## Task 14: Build complaint analysis, history and response editing

**Create:** `src/features/complaints/complaint-form.tsx`, `src/features/history/history-table.tsx`, `src/features/responses/response-editor.tsx`, `src/app/(app)/analyses/new/page.tsx`, `src/app/(app)/complaints/page.tsx`, `src/app/(app)/history/page.tsx`, `tests/e2e/analysis-workflow.spec.ts`, `tests/e2e/response-conflict.spec.ts`.

- [ ] Build complaint capture with category, scope, exact period and original text. Allow saving without a report. The New Analysis flow selects a saved compatible report or embeds/links to the import flow while preserving the saved complaint ID.
- [ ] Start analysis with a stable idempotency key; display synchronous progress/error states and navigate to the saved analysis. An insufficient-data result is a real saved analysis with named missing evidence, not an exception or a silent success verdict.
- [ ] Implement complaint filters/status changes and history date/client/diagnosis filters. Report selector switches the entire saved analysis, including complaint, evidence and response; never leave right-hand panels referring to the previous selection. Reanalyze starts a new analysis with a predecessor link.
- [ ] Build response editor with original/generated view, local unsaved state, save, copy, regenerate and conflict UI. On a 409 show server and local text with manual reconciliation controls; preserve both. Unsaved changes trigger confirmation on regeneration or navigation away.
- [ ] Browser-test demo-equivalent imported data producing `post_click`, moderate evidence, and unverified no-leads outcome. Assert visible +74%, +31, −43%, 3x and evidence rates. Save a draft, reload and check exact text; download Markdown with saved version.
- [ ] Use two browser contexts for concurrent draft editing and assert one conflicting save retains its text. Simulate denied clipboard permission and verify the manual-copy fallback.
- [ ] Run `npm run test:e2e -- tests/e2e/analysis-workflow.spec.ts tests/e2e/response-conflict.spec.ts`. Expected: persisted end-to-end result and safe edit conflicts. Commit `feat: complete complaint analysis history and response review`.

## Task 15: Complete templates, settings and non-happy-path UX

**Create:** `src/app/(app)/templates/page.tsx`, `src/app/(app)/settings/page.tsx`, `tests/e2e/navigation-and-states.spec.ts`.

- [ ] Implement owner template create/edit/reset with token validation and preview. Analysts see read-only content. Settings show actual membership/profile, workspace name, retention choices and sign out; no fake connector status or notification toggles.
- [ ] Audit every screenshot navigation item and control: Dashboard, Upload Report, Complaints, Analysis History, Clients, Templates, Settings, New Analysis, report selector, chart ranges, full report, copy and edit. All release-1 destinations and controls must function.
- [ ] Implement recoverable states from spec §4.4 across pages. Retry failed reads; keep unsaved forms on failed writes; show gaps instead of zeros; treat 401 as expired sign-in, 403 as role limitation, 404 as unknown/inaccessible, 409 as conflict and 503 as retryable service error.
- [ ] Display freshness as actual report end/export times. Historical analyses are not recomputed because time passed; a historical badge may explain old dates. Do not falsely show every dataset refreshed at the latest source's timestamp.
- [ ] Browser-test all navigation items, empty account onboarding, no optional trend, no optional forms, insufficient evidence, analyst restrictions and server failure recovery. Disable only genuinely unavailable controls with an explanation.
- [ ] Run `npm run test:e2e -- tests/e2e/navigation-and-states.spec.ts`. Expected: no dead navigation, no disappearing user edits and no fabricated empty metrics. Commit `feat: complete workspace settings and recovery states`.

## Task 16: Implement retention, deletion and operational hardening

**Create:** `src/server/services/retention.ts`, `src/server/services/delete-client.ts`, `scripts/maintenance.ts`, `src/app/api/health/live/route.ts`, `src/app/api/health/ready/route.ts`, `tests/integration/retention.test.ts`, `tests/integration/security-boundaries.test.ts`.  
**Modify:** `src/app/api/clients/[id]/route.ts`, `src/app/(app)/clients/[clientId]/page.tsx`, `src/server/http.ts`, `docs/deployment.md`.

- [ ] Implement owner-only typed-name deletion with server validation and one cascading transaction, retaining only the opaque deletion audit. Block analyst attempts and foreign IDs. Explain that downloaded copies and operator backups have separate lifetimes.
- [ ] Implement retention rules exactly from spec §10 using an injectable cutoff clock and a transaction/batched deletion strategy. Delete old analyses/revisions, then only unreferenced old reports; preserve recent analyses' referenced reports. Expire old drafts and remove obsolete idempotency records. Parent/supersedes links use nullable references that cannot prevent legitimate deletion.
- [ ] Add `npm run maintenance -- --dry-run` and `npm run maintenance -- --apply`. Dry run reports counts only; apply records audit counts. Configure a daily host scheduler in documentation. Neither command may target a database implicitly chosen from a test fallback.
- [ ] Add minimal health endpoints, safe structured logging, body limits, same-origin checks, security headers and deployment proxy sign-in rate limiting. Confirm private pages/exports are not cached publicly and server secrets do not appear in client bundles.
- [ ] Test retention at exact cutoff, retained analysis referencing old report, client cascade rollback on failure, idempotency cleanup and repeat maintenance. Table-drive all API families for unauthorized foreign IDs, analyst mutations, CSRF/origin failure, large chunked upload and escaped hostile text.
- [ ] Run `npm run test:integration -- tests/integration/retention.test.ts tests/integration/security-boundaries.test.ts`. Expected: safe deterministic cleanup and no cross-tenant access. Commit `feat: add data lifecycle controls and operational safeguards`.

## Task 17: Verify the complete acceptance matrix

**Create:** `tests/e2e/accessibility.spec.ts`, `tests/e2e/responsive.spec.ts`, `tests/integration/persistence.test.ts`, `tests/unit/performance.test.ts`, `docs/verification.md`.

- [ ] Map AC-01 through AC-24 to named tests and record them in `docs/verification.md`. The matrix at the end of this plan is the initial map; replace “planned” with actual commands/results during implementation.
- [ ] Run a real persistence test: create a client/report/analysis/draft through the app, restart the application without resetting its database, then verify the same IDs/result/draft. Separately verify migrations from a clean database. Do not call a mocked repository response “restart persistence.”
- [ ] Run axe checks and keyboard navigation on login, import wizard, analysis dashboard, evidence drawer and response-conflict dialog. Check headings, focus return, contrast and reduced-motion behavior. Resolve serious/critical accessibility violations; manually verify what automation cannot assess.
- [ ] Capture the five viewport sizes in task 12. Compare desktop hierarchy to the screenshot, inspect chart/table readability and confirm document-wide overflow is absent at 390 px. Keep golden screenshots only if the renderer/fonts are stabilized; otherwise record manual images and checks.
- [ ] Benchmark maximum accepted normalized rows against the spec's domain/import targets and record machine details. Benchmark calculation separately from database and chart rendering. If a target fails, fix the measured bottleneck or document a concrete revised capacity for user review; do not quietly lower limits.
- [ ] Run the following complete gate once the final changes are in place. Expected: all commands exit 0, no skipped mandatory scenario, and production build succeeds.

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

- [ ] Record exact commands, versions, pass/fail counts, screenshot paths and any limitations. No fabricated test evidence. Once the gate passes, repeat only affected checks after subsequent changes. Commit `test: verify full agency analysis acceptance matrix`.

## Task 18: Package and hand off the runnable application

**Create:** `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `scripts/seed-demo.ts`, `README.md`, `docs/setup.md`, `docs/deployment.md`, `docs/data-imports.md` as needed.  
**Modify:** `compose.yml`, `.env.example`, `docs/verification.md`.

- [ ] Provide a production Node container build and documented application-plus-PostgreSQL deployment. Run migrations as a controlled release step, not automatically from every web process. Document TLS/reverse proxy, secure cookies, database backups, 30-day backup retention, restore checks and daily maintenance.
- [ ] Implement a development-only fictional demo seed with explicit workspace targeting and idempotency. The public `/demo` stays a read-only fixture and never requires creating a production demo user. No embedded credentials in source or image.
- [ ] Document exact fresh-install sequence: install locked dependencies, start local PostgreSQL, copy/configure environment, migrate, provision owner, run dev server, import provided templates and create analysis. Document password-reset/deactivation CLI and production signup disablement.
- [ ] Add CI for lint/types/unit/build plus isolated PostgreSQL integration and browser checks. CI secrets come from environment configuration; test data remains fictional. Do not add a deployment action that publishes without user authorization.
- [ ] Perform a clean setup rehearsal using the README in a separate temporary checkout/directory. Verify the default response path works without Google credentials, model keys or outbound model calls. Record the result in `docs/verification.md`.
- [ ] Provide the user a concise completion note: implemented workflow, how to run it, verification evidence, intentional departures from the screenshot, and deferred connectors. Do not claim live Google ingestion, AI-generated diagnosis, statistically calibrated confidence or proven root cause.
- [ ] Commit `docs: package and document the upload-first release`. Deployment and any external publication require the user's applicable authorization; the local implementation can be complete before deployment.

## Acceptance-to-task traceability

| Acceptance | Primary tasks | Main evidence |
|---|---|---|
| AC-01 persistence | 7, 9, 10, 17, 18 | Integration restart and clean setup rehearsal |
| AC-02 exact demo | 3, 4, 5, 12, 14 | Numeric unit assertions and dashboard browser flow |
| AC-03 acquisition | 5 | Diagnosis fixture |
| AC-04 mixed | 5 | Diagnosis fixture |
| AC-05 measurement | 2, 5 | Precedence fixture |
| AC-06 insufficient | 2, 5, 15 | Eligibility fixture and UI state |
| AC-07 normalized errors | 3, 5 | Constant failure-rate fixture |
| AC-08 zero/null math | 3 | Exact metric edge cases |
| AC-09 rank/traffic divergence | 3, 5 | Matched-cohort fixture |
| AC-10 no-leads unknown | 5, 6, 14 | Assessment unit test and visible caveat |
| AC-11 CRM-confirmed outcome | 5, 6 | Independent outcome fixture |
| AC-12 keyword coverage | 2, 3, 4 | Cohort/parser fixtures |
| AC-13 retries/conflicts | 9, 10 | Parallel database requests |
| AC-14 tenant isolation | 7–11, 16 | Scoped API matrix and DB constraints |
| AC-15 response conflict | 10, 14 | Two-context browser test |
| AC-16 hostile imports | 4, 9, 11, 16 | Parser/HTTP/export cases |
| AC-17 responsive/accessibility | 12, 15, 17 | Screenshots, axe, keyboard checks |
| AC-18 historical immutability | 9, 10 | Correction/rule-version tests |
| AC-19 chart/subset honesty | 4, 11, 12 | View-model tests and data table |
| AC-20 no model dependency | 5, 6, 18 | Offline domain tests and clean setup |
| AC-21 retention/deletion | 16 | Cutoff/reference/cascade tests |
| AC-22 indirect forms | 5 | Scope-specific evidence fixture |
| AC-23 period mismatch | 2, 5 | Complaint alignment fixture |
| AC-24 conversion collapse | 5 | Zero-current-leads fixture |

## Deferred phases: implementation entry criteria

These phases require their own focused plans after release 1. They must reuse `NormalizedReport`, `AnalysisResult`, immutable snapshots and the diagnosis engine; do not add data-specific logic inside dashboard components.

1. **Live analytics:** GA4 and Search Console OAuth/property selection, encrypted refresh tokens, read-only scopes, quota-aware sync, timezone/coverage preservation and normalized integration fixtures. Entry criterion: release-1 acceptance passes and user chooses required accounts/providers.
2. **Form/delivery evidence:** one chosen backend or monitoring system with documented attempt/failure/delivery semantics. Entry criterion: actual instrumentation source identified; aggregate traffic reports are insufficient.
3. **AI narrative:** server-only provider adapter, redacted approved facts, structured output validation and reliable template fallback. Entry criterion: user selects provider/data-sharing preference; numeric decisions remain deterministic.
4. **Agency collaboration/commercialization:** invitations, self-service recovery, finer permissions, branded PDF/client portal, billing and scheduled reports. Entry criterion: core workflow validated with real agency users and explicit product scope.

## Suggested prompt for the implementing agent

> Read `docs/superpowers/specs/2026-09-07-sightline-design.md` and this implementation plan completely. Implement release 1 in task order, preserving existing workspace work. Build the upload-first persistent application and recreate the supplied screenshot's dashboard hierarchy using the documented visual tokens. Follow the exact data contracts and diagnosis rules, including missing-data behavior, separate received-lead assessment, tenant isolation and immutable analysis history. Use fictional fixtures for the demo, but run real imports and persistence for authenticated workflows. Verify AC-01 through AC-24, record actual results in `docs/verification.md`, and deliver setup instructions. Do not substitute a static mockup for the working app or silently add live Google/model dependencies. Do not deploy or send external messages unless separately authorized.
