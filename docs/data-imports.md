# Data imports

Release 1 accepts five documented CSV templates and a manual entry form that uses
the identical schema and validation path. It does **not** accept arbitrary
provider exports, PDFs or screenshots. You convert a provider export into these
headers yourself, which keeps every imported number traceable to one stated
definition.

Download the blank templates from the import wizard, or from
`public/templates/` in this repository.

## Why conversion is required

A Google Analytics or Search Console export does not carry the definitions this
application needs to make a defensible comparison: which channel filter was
applied, which event counts as a lead, whether the export covers the whole
window, and which time zone the dates are in. Rather than guess, the wizard asks
for those facts once as report metadata and then reads only tabular rows from
the file.

## What a traffic report can and cannot tell you

Two limits matter, because ignoring them is how a confident wrong answer gets
produced:

- **Form failures are not in a traffic report.** An analytics export can show
  that a `form_submit` event fired. It cannot show that the submission reached
  the backend, that the backend accepted it, or that an email or CRM record was
  created. Failure evidence must come from the form backend or a monitoring
  tool, which is a separate source with its own definition of "attempt" and
  "failure".
- **Received leads are not in a traffic report.** `lead_sessions` counts
  sessions containing the configured lead action. It is not an event count and
  it is not a deduplicated count of leads that arrived in the client's inbox or
  CRM. Only a CRM, call-tracking or inbox source can establish that, and it is
  entered separately as a business outcome.

This is why a complaint of "we got no leads" can remain **unverified** even when
the report is complete and the analysis is confident about where to investigate.

## Templates

### `organic-summary.csv` — required

```csv
period,sessions,active_users,lead_sessions
baseline,7210,5800,151
current,12540,10150,150
```

Exactly two rows, one `baseline` and one `current`. `sessions` is required.
`active_users` and `lead_sessions` may be blank, which means unknown — never
zero. `lead_sessions` can never exceed `sessions`.

`active_users` must be an aggregate unique-user total supplied for that exact
window. Daily unique users are never summed into a longer total, because the
same person visiting on two days is one user, not two.

### `keywords.csv` — optional

```csv
period,keyword,device,location,search_engine,position,intent,tracked
baseline,seo services,desktop,US,google,18,commercial,true
current,seo services,desktop,US,google,6,commercial,true
```

The comparison key is `keyword + device + location + search_engine`, compared
after whitespace normalisation and Unicode case folding. A member enters the
cohort only if it appears in **both** periods, is `tracked=true` in both, and is
`intent=commercial` in both.

- A **blank** `position` on a row that exists means confirmed unranked.
- An **absent row** means unknown, and the member is excluded entirely.
- These are different, and the application never converts either into a
  synthetic rank such as 100.

Set the dataset's source kind to `rank_tracker` for fixed-position tracking, or
`gsc` for Search Console. Search Console reports *average observed position*
over an incomplete query universe, so those rows provide descriptive context but
can never activate the fixed-cohort rank rule, and the two source kinds are
never pooled into one cohort.

### `forms.csv` — optional

```csv
period,form_id,scope,attempts,failed_attempts,error_events
baseline,contact,organic_search,200,5,5
current,contact,organic_search,220,15,15
```

`attempts` and `failed_attempts` are **unique logical attempts** from one
instrumentation source. `error_events` may fire several times for a single
attempt and is therefore counted separately and never used as a rate numerator.
This distinction is the reason error counts rising 3x can coexist with a
completely unchanged failure rate.

You select one form and one scope for the report. Other forms can be imported
for inspection, but their rates are never pooled.

`scope=all_channels` form evidence against an organic-only complaint is treated
as indirect corroboration. It is displayed, but it cannot on its own activate or
strengthen a post-click diagnosis.

### `landing-pages.csv` — optional

```csv
period,path,sessions
baseline,/seo-services,1250
current,/seo-services,2340
```

Paths begin with `/` and carry no query string or fragment. These are
landing-page sessions, not page views, and the table is displayed as a labelled
subset rather than a reconciliation of all site traffic.

### `traffic-trend.csv` — optional

```csv
start_date,end_date,sessions,active_users
2026-06-12,2026-07-11,7210,5800
2026-07-12,2026-08-10,12540,10150
```

Every row is an aggregate that was actually supplied for that exact bucket.
Buckets may not overlap. If a bucket exactly covers a summary window, its
`sessions` and any known `active_users` must equal that window's summary totals;
a mismatch is a validation error naming both inputs rather than two conflicting
numbers on one dashboard.

If you supply no trend file, the dashboard shows "Trend data not provided". It
never draws a line between two summary values.

## Business outcomes

Received leads, qualified leads and revenue are entered through a structured
manual form rather than a CSV, because each needs an attribution note and a
definition version alongside the number. Zero is allowed and meaningful — an
explicitly supplied zero is what makes a "no leads" complaint *supported* rather
than *unverified*. Qualified leads can never exceed received leads for the same
period and population. Revenue is in currency minor units and requires a
three-letter currency code.

## Limits and safety

| Limit | Value |
|---|---|
| Bytes per file | 5 MiB |
| Rows per file | 20,000 |
| Characters per text cell | 2,000 |
| Bytes per report | 25 MiB |
| Rows per report | 50,000 |
| Errors returned per validation | First 100, plus the true total |

Rejected on import: invalid UTF-8, duplicate headers, unknown headers, missing
required headers, malformed quoting, mismatched column counts, thousands
separators, ambiguous localized decimals, non-finite values, fractional counts
and cells beginning with `=`, `+`, `-` or `@`.

That last rule matters because a cell such as `=cmd|'/c calc'!A1` is executed by
some spreadsheets when a downloaded CSV is opened. Such cells are refused on
import, and any text that reaches an export by another route is neutralised with
a leading apostrophe on the way out.

File contents are never evaluated. Uploaded bytes are discarded after
normalisation; the application retains the normalised rows, the source metadata,
a sanitised file name and a SHA-256 hash of the original bytes. A download of
normalised data is therefore not advertised as your original file.
