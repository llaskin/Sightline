import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Readiness: the database answers.
 *
 * A failure returns 503 with no driver message, host name or connection string,
 * because this endpoint is typically reachable from a load balancer and must
 * not describe the internals to whoever can reach it.
 */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json(
      { status: 'ready' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
