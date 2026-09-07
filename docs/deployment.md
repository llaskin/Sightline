# Deployment

This release is one Node application plus one PostgreSQL database. There is no
worker, no queue, no cache and no third-party service. Release 1 requires **no
Google credentials and no AI provider key**.

Nothing in this repository deploys anything on its own. There is no deployment
workflow, and CI does not publish.

## What needs deploying

| Component | What it is | Notes |
|---|---|---|
| Application | Next.js 16 server, Node runtime | Built with `npm run build`, served by `npm run start`. Every API and page handler needs Node, not Edge, because they open a TCP database connection. |
| Database | PostgreSQL 16 | The only stateful component. |
| Reverse proxy / TLS | Your platform's | Terminates HTTPS and applies the sign-in rate limit below. |
| Scheduler | Your platform's cron | Runs the daily maintenance command below. |

**Not affected and not deployed:** no analytics connector, no rank tracker, no
CRM, no email sender, no model provider. Those are later phases.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Application database. |
| `BETTER_AUTH_SECRET` | yes | Session signing secret, at least 32 characters. Generate with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes | Public base URL, e.g. `https://sightline.example.com`. |
| `APP_ORIGIN` | yes | Origin allowed to send state-changing requests. Normally identical to `BETTER_AUTH_URL`. |
| `NODE_ENV` | yes | `production`. This enables secure cookies and refuses demo seeding. |
| `TEST_DATABASE_URL` | no | CI only. Must never point at production. |

The application refuses to start with an invalid configuration and names only
the *fields* that are wrong, never their values.

## Release sequence

Migrations are a deliberate release step. No web process applies them on boot,
so several instances starting at once cannot race each other.

```bash
# 1. Build
npm ci
npm run build

# 2. Apply migrations once, from a single place
DATABASE_URL="postgres://..." npm run db:migrate

# 3. Start (or roll) the application
npm run start
```

For a container deployment, build the image, run the migration step as a
one-off task against the new image, then roll the web instances.

## First-run provisioning

There is no public sign-up and no HTTP bootstrap endpoint. The first owner is
created deliberately by an operator:

```bash
NEW_PASSWORD='<a long random password>' \
  npm run provision:user -- --email owner@agency.example \
    --name "Owner Name" --workspace "Agency Name" --role owner
```

Additional users join an existing workspace by id:

```bash
NEW_PASSWORD='...' npm run provision:user -- --email analyst@agency.example \
  --name "Analyst Name" --workspace-id <uuid> --role analyst
```

Passwords are read from `NEW_PASSWORD` or an interactive prompt, never from a
command-line argument, so they do not enter shell history or the process list.

To reset a password or revoke access:

```bash
npm run reset:password -- --email someone@agency.example              # sets a new password
npm run reset:password -- --email someone@agency.example --deactivate  # revokes access now
npm run reset:password -- --email someone@agency.example --activate
```

Both revoke that user's existing sessions immediately. A deactivated membership
loses access on the very next request even though the session cookie is still
unexpired.

## TLS, cookies and headers

- Terminate TLS at the proxy and forward only HTTPS traffic.
- With `NODE_ENV=production` the session cookie is set `Secure`, `HttpOnly` and
  `SameSite=Lax`. Same-origin is enforced a second time in the application: a
  mutation must carry an `Origin` matching `APP_ORIGIN`.
- Private pages and exports send `Cache-Control: private, no-store`. Configure
  the proxy not to cache any authenticated response.

## Sign-in rate limiting

The auth library applies its own limit. Add a proxy limit as well, because a
proxy limit survives an application restart and applies before the request
reaches Node.

Documented limit: **10 sign-in attempts per minute per IP** on
`/api/auth/sign-in/*`.

nginx example:

```nginx
limit_req_zone $binary_remote_addr zone=signin:10m rate=10r/m;

location /api/auth/sign-in/ {
  limit_req zone=signin burst=5 nodelay;
  proxy_pass http://app;
}
```

## Health checks

| Endpoint | Meaning |
|---|---|
| `GET /api/health/live` | The process is running. Touches nothing else. Use for liveness. |
| `GET /api/health/ready` | The database answered a query. Use for readiness and for load-balancer registration. |

Readiness returns 503 with no driver message, host name or connection string,
because it is typically reachable from the load balancer.

## Daily maintenance

Schedule this once a day. It is safe to run repeatedly and safe to miss a day.

```bash
# Report only, change nothing
npm run maintenance -- --dry-run

# Apply
npm run maintenance -- --apply
```

It applies the workspace retention setting and purges import drafts that expired
seven days after their last edit. It refuses to run if `DATABASE_URL` is unset
or equals `TEST_DATABASE_URL`.

crontab example:

```
17 3 * * * cd /srv/sightline && /usr/bin/npm run maintenance -- --apply >> /var/log/sightline-maintenance.log 2>&1
```

## Retention and deletion

Default retention is **indefinite** until an owner deletes something. An owner
may set 90, 180 or 365 days, which then:

1. deletes analyses older than the cutoff, and their response revisions;
2. deletes reports older than the cutoff **only** where no retained analysis
   still references them;
3. removes idempotency records whose result no longer exists.

Complaints and clients are never removed by retention. They go only by explicit
owner deletion, which requires the client's name typed exactly and removes that
client's complaints, drafts, reports, analyses and response revisions in one
transaction, retaining only an opaque audit event with no name, domain or
content.

Two limits are worth stating to users plainly:

- **Exports already downloaded cannot be recalled.** A Markdown or CSV file
  someone saved is outside this application entirely.
- **Deleting from the database does not purge backups.** A restored backup can
  reintroduce deleted data.

## Backups and restore

- Take regular `pg_dump` backups. **Operator-managed retention default: 30
  days.** Adjust to your own obligations and record what you chose.
- Store backups encrypted and separately from the database host.
- Test a restore periodically. A backup nobody has restored is a hope.
- **After restoring, re-run the retention and deletion procedures before
  serving users again.** A restore can otherwise resurrect records an owner
  deliberately deleted, including a client deleted on request.

## Logging

Logs carry request identifiers, error codes, timings and row counts. They do
not carry complaint text, report rows, source values, email addresses or
credentials. Keep it that way when adding logging: the whole point of the data
model is that report content stays inside the database.

## Deliberately absent

No live Google connector, no rank tracker integration, no CRM integration, no
model-generated narrative, no email sending, no billing, no public sign-up, no
self-service password recovery. Do not configure infrastructure for these; they
are separate phases with their own entry criteria.
