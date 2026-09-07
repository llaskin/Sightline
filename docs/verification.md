# Verification

Actual recorded results. Nothing in this file is a projection: every command
listed was run, and its real output is reported, including anything that failed
or could not be checked.

## Environment

| Item | Value |
|---|---|
| Host | macOS (Darwin 25.5.0), Apple silicon |
| Node.js | 25.6.1 |
| npm | 11.9.0 |
| PostgreSQL | 16.14 (`postgres:16-alpine`) on port 5433 |
| Next.js | 16.3.4 |
| React | 19.2.8 |
| Vitest | 4.1.11 |
| Playwright | 1.63.0 |

## Milestone A — domain foundation

Verified with no database, no network and no model key present.

| Command | Started | Finished | Result |
|---|---|---|---|
| `npm run lint` | 2026-09-07 12:52 | 2026-09-07 12:52 | exit 0 |
| `npm run typecheck` | 2026-09-07 12:52 | 2026-09-07 12:52 | exit 0 |
| `npm run test:unit` | 2026-09-07 12:52 | 2026-09-07 12:52 | 176 passed / 176 |
| `npm run build` | 2026-09-07 12:37 | 2026-09-07 12:37 | exit 0 |

Unit coverage by file, at commit `bb67492`:

| Test file | Cases | Covers |
|---|---|---|
| `tests/unit/report-schema.test.ts` | 16 | Field, row and cross-row invariants |
| `tests/unit/comparability.test.ts` | 18 | Windows, DST, coverage, measurement precedence |
| `tests/unit/metrics.test.ts` | 17 | Arithmetic, cohorts, forms |
| `tests/unit/format.test.ts` | 9 | Display rounding and missing-value words |
| `tests/unit/imports.test.ts` | 35 | CSV acceptance, rejection, bounds, demo fixture |
| `tests/unit/analysis.test.ts` | 40 | Diagnosis table, thresholds, strength, injection |
| `tests/unit/complaint-assessment.test.ts` | 23 | Outcome assessment per category |
| `tests/unit/render-response.test.ts` | 18 | Template validation, mandatory caveats |

### Demo scenario, measured

Produced by running the real engine against `makeDemoReport()`, not hardcoded:

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

The displayed **-43%** is deliberately not the screenshot's -42%: -42.884756%
rounds to -43%. Lead sessions moved 151 to 150, so the demo does not claim zero
confirmed leads.

## Milestone B — persistent workflow

Pending.

## Milestone C — recreated product

Pending.

## Milestone D — release verification

Pending.

## Acceptance matrix

| ID | Scenario | Status | Evidence |
|---|---|---|---|
| AC-01 | Fresh install and restart | pending | |
| AC-02 | Demo scenario | **pass** | `tests/unit/analysis.test.ts` "AC-02 demo scenario" (4 cases); table above |
| AC-03 | Traffic down, no conversion concern | **pass** | `tests/unit/analysis.test.ts` "AC-03" |
| AC-04 | Traffic and conversion both down | **pass** | `tests/unit/analysis.test.ts` "AC-04" |
| AC-05 | Known tracking issue takes precedence | **pass** | `tests/unit/analysis.test.ts` "AC-05" (2 cases) |
| AC-06 | Missing/partial coverage or <100 sessions | **pass** | `tests/unit/analysis.test.ts` "AC-06" (3 cases) |
| AC-07 | Error count 5→15, attempts 100→300 | **pass** | `tests/unit/analysis.test.ts` "AC-07" (2 cases) |
| AC-08 | Zero/null arithmetic | **pass** | `tests/unit/metrics.test.ts` "preserves zero and unknown", "never emits NaN or Infinity" |
| AC-09 | Sessions rise, ranks deteriorate | **pass** | `tests/unit/analysis.test.ts` "AC-09" (3 cases) |
| AC-10 | No received-lead evidence | **pass** | `tests/unit/complaint-assessment.test.ts` "AC-10" |
| AC-11 | CRM-confirmed zero leads | **pass** | `tests/unit/complaint-assessment.test.ts` "AC-11" (5 cases) |
| AC-12 | Missing rows, mixed GSC/rank-tracker | **pass** | `tests/unit/analysis.test.ts` "AC-12"; `metrics.test.ts` cohort cases |
| AC-13 | Stale draft, retry, concurrent writes | pending | |
| AC-14 | Cross-workspace IDs | pending | |
| AC-15 | Response save/regenerate conflict | pending | |
| AC-16 | Malformed/oversized/formula CSV | partial | `tests/unit/imports.test.ts` rejection and bounds; HTTP layer pending |
| AC-17 | Mobile, keyboard, no trend input | pending | |
| AC-18 | Rule upgrade or report correction | pending | |
| AC-19 | Trend rows and page subset | partial | `tests/unit/imports.test.ts` trend agreement; view model pending |
| AC-20 | No model key or network | **pass** | Whole unit suite runs offline with no provider key present |
| AC-21 | Retention and client deletion | pending | |
| AC-22 | All-channel form on organic complaint | **pass** | `tests/unit/analysis.test.ts` "AC-22" (2 cases) |
| AC-23 | Complaint period differs from report | **pass** | `tests/unit/complaint-assessment.test.ts` "AC-23" (3 cases) |
| AC-24 | Baseline ≥20 leads, current zero | **pass** | `tests/unit/analysis.test.ts` "AC-24" (2 cases) |

## Known limitations

- `npm audit` reports 4 moderate advisories, all via
  `drizzle-kit -> @esbuild-kit/esm-loader -> esbuild`. This is a migration CLI
  dependency, absent from the application runtime and the production image.
  `@esbuild-kit/*` is deprecated upstream with no patched release.
