import './load-env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from '@/server/db/schema';

/**
 * Refuses to run against anything but a database whose name ends in `_test`,
 * and never falls back to DATABASE_URL. This suite truncates every table, so
 * that guard is the difference between a clean test run and destroying
 * development data.
 */
export function assertTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests never fall back to DATABASE_URL.',
    );
  }
  let databaseName: string;
  try {
    databaseName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL');
  }
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run destructive tests against "${databaseName}": the database name must end in _test.`,
    );
  }
  return url;
}

/**
 * Confirms the configured test database is a different database from the
 * development one. This runs once, before the suite redirects DATABASE_URL at
 * the test database; afterwards the two are equal by design.
 */
export function assertDistinctFromDevelopmentDatabase(): void {
  const url = assertTestDatabaseUrl();
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    throw new Error(
      'TEST_DATABASE_URL and DATABASE_URL point at the same database. ' +
        'Integration tests truncate every table, so they must be separate.',
    );
  }
}

let cached: ReturnType<typeof create> | null = null;

function create(url: string) {
  const client = postgres(url, { max: 5, prepare: false });
  return { db: drizzle(client, { schema }), client };
}

export function testDb() {
  if (!cached) cached = create(assertTestDatabaseUrl());
  return cached.db;
}

const TABLES = [
  'idempotency_records',
  'audit_events',
  'response_revisions',
  'analyses',
  'reports',
  'import_drafts',
  'complaints',
  'response_templates',
  'clients',
  'memberships',
  'workspaces',
  'session',
  'account',
  'verification',
  '"user"',
];

export async function resetDatabase(): Promise<void> {
  assertTestDatabaseUrl();
  await testDb().execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));
}

export async function closeDatabase(): Promise<void> {
  if (cached) {
    await cached.client.end({ timeout: 5 });
    cached = null;
  }
}
