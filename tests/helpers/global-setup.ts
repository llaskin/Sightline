import './load-env';
import { execFileSync } from 'node:child_process';
import { assertTestDatabaseUrl, assertDistinctFromDevelopmentDatabase } from './database';

/**
 * Migrates the isolated integration-test database once per run.
 *
 * `TEST_DATABASE_URL` is the only source; there is deliberately no fallback to
 * `DATABASE_URL`, because this suite truncates every table.
 */
export default function setup() {
  assertDistinctFromDevelopmentDatabase();
  const url = assertTestDatabaseUrl();
  execFileSync('npx', ['drizzle-kit', 'migrate'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
