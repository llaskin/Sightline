import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

/**
 * Prepares an isolated database for the browser suite: migrate, wipe, then
 * provision one owner and one analyst through the real CLI path.
 *
 * The name must end in `_e2e` or `_test`. This suite truncates every table, so
 * running it against the development database would destroy local work.
 */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error('E2E_DATABASE_URL is not set. Browser tests need their own database.');

  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_e2e') && !name.endsWith('_test')) {
    throw new Error(`Refusing to run browser tests against "${name}": the name must end in _e2e.`);
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('E2E_DATABASE_URL must differ from DATABASE_URL.');
  }

  execFileSync('npx', ['drizzle-kit', 'migrate'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });

  const sql = postgres(url, { max: 2 });
  try {
    await sql.unsafe(`
      TRUNCATE idempotency_records, audit_events, response_revisions, analyses,
        reports, import_drafts, complaints, response_templates, clients,
        memberships, workspaces, session, account, verification, "user"
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Provisioned through the real CLI, so the browser suite exercises the same
  // account-creation path an operator uses.
  const env = {
    ...process.env,
    DATABASE_URL: url,
    NEW_PASSWORD: E2E_PASSWORD,
    NODE_ENV: 'test' as const,
  };
  execFileSync(
    'npx',
    ['tsx', 'scripts/provision-user.ts', '--email', E2E_OWNER, '--name', 'Alex Rivera', '--workspace', 'Demo Agency', '--role', 'owner'],
    { stdio: 'inherit', env },
  );

  const sql2 = postgres(url, { max: 2 });
  let workspaceId: string;
  try {
    const rows = await sql2.unsafe('select id from workspaces limit 1');
    workspaceId = (rows[0] as unknown as { id: string }).id;
  } finally {
    await sql2.end({ timeout: 5 });
  }

  execFileSync(
    'npx',
    ['tsx', 'scripts/provision-user.ts', '--email', E2E_ANALYST, '--name', 'Sam Okafor', '--workspace-id', workspaceId, '--role', 'analyst'],
    { stdio: 'inherit', env },
  );

  process.env.E2E_WORKSPACE_ID = workspaceId;
}

export const E2E_OWNER = 'owner@example.com';
export const E2E_ANALYST = 'analyst@example.com';
export const E2E_PASSWORD = 'e2e-local-password-1234';
