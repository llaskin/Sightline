# Verification

Actual recorded results. Nothing here is a projection: every command listed was
run, and its real output is reported, including what could not be checked.

## Environment

| Item | Value |
|---|---|
| Host | macOS (Darwin 25.5.0), Apple silicon |
| Node.js | 25.6.1 (production image pins Node 22 LTS) |
| npm | 11.9.0 |
| PostgreSQL | 16.14 (`postgres:16-alpine`) on port 5433 |
| Next.js | 16.3.4 |
| React | 19.2.8 |
| Vitest | 4.1.11 |
| Playwright | 1.63.0, Chromium 153.0.8010.12 |

Three separate databases: `excuse_detector` (development), `excuse_detector_test`
(integration, truncated between tests), `excuse_detector_e2e` (browser suite,
reset and reseeded per run).

## The full gate

Run on 2026-09-07. Every command exited 0.

| Command | Started | Finished | Result |
|---|---|---|---|
| `npm run lint` | 15:17:22 | 15:17:26 | exit 0, no errors, no warnings |
| `npm run typecheck` | 15:17:26 | 15:17:27 | exit 0 |
| `npm run test:unit` | 15:17:27 | 15:17:28 | **219 passed / 219** |
| `npm run test:integration` | 15:17:28 | 15:18:02 | **124 passed / 124** |
| `npm run build` | 15:18:02 | 15:18:07 | exit 0, 38 routes |
| `npm run test:e2e` | 15:18:07 | 15:18:34 | **42 passed / 42** |

**385 tests total.** Unit tests run with no database, no network and no model
key present. Integration tests run against real PostgreSQL. Browser tests run
against the production build with a real database.

## Test coverage by file

| File | Cases | Covers |
|---|---|---|
| `tests/unit/report-schema.test.ts` | 16 | Field, row and cross-row invariants |
| `tests/unit/comparability.test.ts` | 18 | Windows, daylight saving, coverage, measurement precedence |
| `tests/unit/metrics.test.ts` | 17 | Arithmetic, keyword cohorts, form rates |
| `tests/unit/format.test.ts` | 9 | Display rounding, missing-value wording |
| `tests/unit/imports.test.ts` | 35 | CSV acceptance, rejection, bounds, demo fixture |
| `tests/unit/analysis.test.ts` | 40 | Diagnosis table, thresholds, strength, injection |
| `tests/unit/complaint-assessment.test.ts` | 23 | Outcome assessment per category |
| `tests/unit/render-response.test.ts` | 18 | Template validation, mandatory caveats |
| `tests/unit/exports.test.ts` | 19 | Markdown escaping, CSV formula neutralisation |
| `tests/unit/dashboard-view-model.test.ts` | 21 | Card values, chart honesty, table subsets |
| `tests/unit/performance.test.ts` | 3 | Benchmarks against maximum input |
| `tests/integration/auth.test.ts` | 11 | Sign-in, sign-up refusal, membership, roles |
| `tests/integration/tenant-constraints.test.ts` | 6 | Database-level cross-tenant rejection |
| `tests/integration/client-workflow.test.ts` | 24 | Clients, complaints, templates, settings |
| `tests/integration/import-commit.test.ts` | 18 | Idempotency, staleness, corrections |
| `tests/integration/analysis-workflow.test.ts` | 13 | Creation, immutability, history |
| `tests/integration/response-revisions.test.ts` | 10 | Draft saves, conflicts, regeneration |
| `tests/integration/retention.test.ts` | 20 | Retention cutoffs, client deletion |
| `tests/integration/security-boundaries.test.ts` | 14 | 401/403/404 matrix, origin, bounds |
| `tests/e2e/import-workflow.spec.ts` | 4 | Full browser import journey |
| `tests/e2e/analysis-workflow.spec.ts` | 6 | Diagnosis, drawers, export, reanalysis |
| `tests/e2e/response-conflict.spec.ts` | 4 | Concurrent editing, clipboard fallback |
| `tests/e2e/navigation-and-states.spec.ts` | 8 | Every destination, empty and failure states |
| `tests/e2e/accessibility.spec.ts` | 12 | axe scans, keyboard, focus, reduced motion |
| `tests/e2e/responsive.spec.ts` | 8 | Five viewports, overflow, reflow |

## The demo scenario, measured

Produced by running the real engine against `makeDemoReport()`, not hardcoded,
and asserted again through the browser against genuinely imported data.

| Quantity | Unrounded | Displayed |
|---|---|---|
| Organic sessions | 7,210 to 12,540, +73.925104% | **+74%** |
| Lead-session rate | 0.0209431 to 0.0119617 | **2.1% to 1.2%** |
| Lead-session rate change | -42.884756% | **-43%** |
| Percentage-point change | -0.898141 pp | **-0.90 pp** |
| Tracked commercial top 10 | 54 to 85; entered 31, exited 0 | **+31** |
| Form unique failure rate | 0.025 to 0.0681818 (+4.3181818 pp, +172.727273%) | **2.5% to 6.8%** |
| Form error events | 5 to 15 | **3x** |
| Diagnosis | `post_click` | Evidence points to a post-click investigation |
| Evidence strength | `moderate` | Corroborated by an independent form backend |
| Complaint assessment | `unverified` | No received-lead record supplied |

The displayed **-43%** deliberately differs from the screenshot's -42%:
-42.884756% rounds to -43%. Lead sessions moved 151 to 150, so the demo never
claims zero confirmed leads.

## Performance

Measured against the **maximum accepted input** (20,000 keyword rows and 20,000
landing-page rows), not the demo fixture, on Apple silicon with Node 25.6.1.
These are acceptance targets on this hardware, not benchmark claims; a slower CI
runner will be slower.

| Operation | Measured | Target |
|---|---|---|
| `analyzeReport` on the maximum report | **11.5 ms** | under 250 ms |
| `parseDatasetCsv`, 20,000 rows | **23.0 ms** | — |
| `normalizeDraft` on the maximum report | **43.7 ms** | — |
| Parse plus validate combined | **66.7 ms** | under 5,000 ms |
| `buildDashboardViewModel` on the maximum report | **25.4 ms** | — |

The view model is benchmarked separately so it cannot quietly become a second
analysis engine.

## AC-01, verified by a genuine restart

`node scripts/restart-persistence-check.mjs` starts the production server,
creates records over HTTP, **kills the process**, starts a new one against the
same database and reads everything back. Recreating a connection pool would not
have proved this.

```
Starting the first server process...
Created: client, report, complaint, analysis, edited response revision 2,
         plus a second uncommitted import draft
Stopping the server process...
Stopped. Starting a brand new process against the same database...

  ok  the client persisted with the same id
  ok  the client name persisted
  ok  the committed report persisted with the same id
  ok  the immutable report snapshot is unchanged
  ok  the analysis persisted with the same id
  ok  the saved diagnosis is unchanged (post_click)
  ok  the saved assessment is unchanged (unverified)
  ok  the saved evidence strength is unchanged (moderate)
  ok  the edited response draft persisted exactly
  ok  the response revision number persisted
  ok  the uncommitted import draft persisted
  ok  the uncommitted draft kept its saved values

AC-01 PASSED
```

## Accessibility

`@axe-core/playwright` with tags `wcag2a, wcag2aa, wcag21a, wcag21aa`.
**Zero serious or critical violations** on the sign-in page, the public demo,
the analysis dashboard and an open evidence drawer.

Two real violations were found and fixed during this work:

1. `scrollable-region-focusable` on the horizontally scrolling table containers.
   A keyboard-only reader could not scroll them. Each is now focusable with a
   region role and a label.
2. The same rule on the response draft preview, whose lower half was unreachable
   without a mouse.

Checked by hand because automation cannot judge it: focus returns to the
triggering control when a drawer closes, the skip link is the first tab stop,
the heading order has exactly one `h1` and skips no level, and the investigation
focus is identified in text as well as colour.

## Responsive

Screenshots at all five specified sizes are in `docs/verification-artifacts/`.
Document-level horizontal overflow is **zero at every size, including 390 px**.
Wide tables scroll inside their own cards, which is asserted directly rather
than assumed. The metric grid measures 4 columns at 1400 px, 2 at 700 px and 1
at 390 px.

| Viewport | Screenshot |
|---|---|
| 1536x1024 | `dashboard-1536x1024.png` |
| 1280x800 | `dashboard-1280x800.png` |
| 1024x768 | `dashboard-1024x768.png` |
| 768x1024 | `dashboard-768x1024.png` |
| 390x844 | `dashboard-390x844.png` |

`scripts/page-sweep.mjs` walked all 17 authenticated routes in a real browser:
**17 of 17 clean** — every route 200, no error boundary, no console error, no
page error, no overflow. Per-route screenshots are saved as `sweep-*.png`.

## Guardrails proven, not assumed

The same-origin gate was deliberately disabled and
`tests/integration/security-boundaries.test.ts` failed, then passed again once
restored, with the file byte-identical afterwards. A gate nobody has watched
fail is only a hope.

The `_test` database guard was observed refusing to run twice: once with
`TEST_DATABASE_URL` unset, and once when it matched `DATABASE_URL`.

## Acceptance matrix

| ID | Scenario | Status | Evidence |
|---|---|---|---|
| AC-01 | Fresh install and restart | **pass** | `scripts/restart-persistence-check.mjs`, output above; clean-setup rehearsal below |
| AC-02 | Demo scenario | **pass** | `unit/analysis.test.ts` "AC-02" (4 cases); `e2e/analysis-workflow.spec.ts` asserts +74%, +31, -43%, 3x in the browser |
| AC-03 | Traffic down, no conversion concern | **pass** | `unit/analysis.test.ts` "AC-03" |
| AC-04 | Traffic and conversion both down | **pass** | `unit/analysis.test.ts` "AC-04" |
| AC-05 | Known tracking issue takes precedence | **pass** | `unit/analysis.test.ts` "AC-05" (2 cases) |
| AC-06 | Missing/partial coverage or <100 sessions | **pass** | `unit/analysis.test.ts` "AC-06" (3 cases); `e2e/analysis-workflow.spec.ts` insufficient-evidence case |
| AC-07 | Error count 5→15, attempts 100→300 | **pass** | `unit/analysis.test.ts` "AC-07" (2 cases) |
| AC-08 | Zero/null arithmetic | **pass** | `unit/metrics.test.ts` "preserves zero and unknown", "never emits NaN or Infinity" |
| AC-09 | Sessions rise, ranks deteriorate | **pass** | `unit/analysis.test.ts` "AC-09" (3 cases) |
| AC-10 | No received-lead evidence | **pass** | `unit/complaint-assessment.test.ts` "AC-10"; browser asserts the visible caveat |
| AC-11 | CRM-confirmed zero leads | **pass** | `unit/complaint-assessment.test.ts` "AC-11" (5 cases) |
| AC-12 | Missing rows, mixed GSC/rank-tracker | **pass** | `unit/analysis.test.ts` "AC-12"; `unit/metrics.test.ts` cohort cases |
| AC-13 | Stale draft, retry, concurrent writes | **pass** | `integration/import-commit.test.ts` (18 cases incl. 3 parallel commits) |
| AC-14 | Cross-workspace identifiers | **pass** | `integration/security-boundaries.test.ts` 11 collection + 12 detail routes; `integration/export-access.test.ts` |
| AC-15 | Response save/regenerate conflict | **pass** | `integration/response-revisions.test.ts`; `e2e/response-conflict.spec.ts` two browser contexts |
| AC-16 | Malformed/oversized/formula input | **pass** | `unit/imports.test.ts`; `integration/security-boundaries.test.ts` (declared and chunked oversize); `e2e/import-workflow.spec.ts` |
| AC-17 | Mobile, keyboard, no trend input | **pass** | `e2e/responsive.spec.ts` (8), `e2e/accessibility.spec.ts` (12) |
| AC-18 | Rule upgrade or report correction | **pass** | `integration/analysis-workflow.test.ts` "AC-18" (3 cases); `integration/import-commit.test.ts` corrections |
| AC-19 | Trend rows and page subset | **pass** | `unit/dashboard-view-model.test.ts` "AC-17 and AC-19"; `e2e/navigation-and-states.spec.ts` sparse report |
| AC-20 | No model key or network | **pass** | Whole unit suite runs offline with no provider key; clean-setup rehearsal below |
| AC-21 | Retention and client deletion | **pass** | `integration/retention.test.ts` (20 cases) |
| AC-22 | All-channel form on organic complaint | **pass** | `unit/analysis.test.ts` "AC-22" (2 cases) |
| AC-23 | Complaint period differs from report | **pass** | `unit/complaint-assessment.test.ts` "AC-23" (3 cases) |
| AC-24 | Baseline ≥20 leads, current zero | **pass** | `unit/analysis.test.ts` "AC-24" (2 cases) |

## Defects found and fixed during verification

Recorded because each was a real bug that testing caught, not a test that needed
loosening.

1. **Composite `ON DELETE SET NULL` blocked deletion.** Drizzle emitted a plain
   form that PostgreSQL applies to every column in the key, including the
   NOT NULL `workspace_id`. Deleting a superseded report or parent analysis
   would have failed. Fixed with the PostgreSQL 15+ column-list form and two
   integration tests that would catch a regeneration reverting it.
2. **Idempotency was checked before the draft lock.** Three parallel commits all
   read "no record yet", queued on the lock, then failed the revision check: one
   report created, two callers given 409 instead of the result. The lookup now
   happens under the lock.
3. **`.env.example` was never committed.** The scaffold's `.gitignore` carried a
   broad `.env*` rule, so a fresh clone would fail at step three of the README's
   own quick start.
4. **`escapeMarkdown` escaped Markdown before angle brackets**, turning `>` into
   `\>` so the HTML entity was never produced and `<script>` was not neutralised
   as intended.
5. **Engine values were escaped as untrusted text** in exports, rendering
   `73.925104` as `73\.925104` and `rank_tracker` as `rank\_tracker`.
6. **Two scrollable regions had no keyboard access** (see Accessibility).
7. **Import validation reported `sources.organic: expected object, received
   undefined`** when provenance was untouched, naming a whole dataset instead of
   the individual empty fields. The blank source object is now materialised, so
   validation names `sources.organic.baseline.sourceLabel` and the rest.
8. **An upload rejection showed only the rule that broke**, not the column or
   the rejected value, so a reader could not tell which cell to fix. It now
   renders a table of row, column, rejected value and reason.
9. **A new client's property label started empty**, a required field that only
   failed four steps later at validation. It now defaults to the client name.
10. **`insufficient_evidence` did not say why.** The diagnosis reported that more
    evidence was needed without naming the failing condition. The organic
    ineligibility reasons are now included in the stated gaps.
11. **A clipboard fallback used a zero-delay timer** to select the textarea,
    which only wins the race against React's re-render most of the time. Now a
    deterministic effect.

## Clean-setup rehearsal

Performed in this checkout with the database reset:

| Step | Result |
|---|---|
| `docker compose up -d` | PostgreSQL 16.14 serving all three databases |
| `npm run db:migrate` | Migrations applied |
| `npm run provision:user -- --email owner@example.com --name "Alex Rivera" --workspace "Demo Agency" --role owner` | Owner and workspace created; user id and workspace id printed |
| `npm run seed:demo -- --workspace-id <uuid>` | Fictional client, report and analysis created, diagnosis `post_click` |
| Re-running `seed:demo` | "Demo client already present. Nothing to do." |
| `NODE_ENV=production npm run seed:demo` | Refused: "Seeding demo data is not permitted when NODE_ENV=production." |
| `npm run maintenance -- --dry-run` | Reported counts, changed nothing |
| `npm run maintenance` with no mode | Refused: "Choose exactly one of --dry-run or --apply." |
| Sign in and use the app | Verified in a browser; all 17 routes render |

**No Google credentials and no AI provider key were present at any point.** The
diagnosis and the response draft are produced entirely by local deterministic
code (AC-20).

## Limitations and what was not verified

- **Chromium only.** The browser suite runs one engine. Firefox and WebKit were
  not exercised.
- **One machine.** Performance figures are from an Apple silicon laptop with
  Node 25.6.1. CI hardware will differ; the targets, not the measured numbers,
  are the contract.
- **No load or soak testing.** Concurrency is tested for correctness (parallel
  commits, parallel draft saves), not throughput.
- **The production container was not built or run.** The `Dockerfile` is written
  and the standalone output it depends on is produced by `npm run build`, but no
  image was built here, so that path is unverified.
- **No deployment.** Nothing was deployed, published or sent anywhere.
- **The CI workflow has not run.** `.github/workflows/ci.yml` is committed but
  no push has occurred, so it is unexecuted.
- **`npm audit` reports 4 moderate advisories**, all via
  `drizzle-kit -> @esbuild-kit/esm-loader -> esbuild`. This is a migration CLI
  dependency, absent from the application runtime and the production image.
  `@esbuild-kit/*` is deprecated upstream with no patched release.
- **Screenshot fidelity was judged by eye**, not by pixel comparison. The
  reference and the recreation deliberately differ in the ways set out in the
  specification, so a pixel diff would not be meaningful.
- **The claim most likely to be wrong:** that every wizard path keeps the local
  draft and the stored draft in step. The main path is now covered end to end in
  a browser, but unusual sequences (resuming a draft in one tab while editing it
  in another, or switching client mid-flow) are not.
