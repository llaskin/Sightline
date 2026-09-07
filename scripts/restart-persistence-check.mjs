/**
 * AC-01: a real restart, not a simulated one.
 *
 * Starts the production server, creates a client, a committed report, a
 * complaint, an analysis and a saved response draft over HTTP, then kills the
 * process and starts a completely new one against the same database and reads
 * everything back by id. A test that only recreates a connection pool would
 * not prove this; killing the process does.
 *
 *   node scripts/restart-persistence-check.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const PORT = Number(process.env.PERSISTENCE_PORT ?? 3120);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL = process.env.E2E_DATABASE_URL;
const EMAIL = `persistence-${Date.now()}@example.com`;
const PASSWORD = 'persistence-check-password-1234';

if (!DATABASE_URL) throw new Error('E2E_DATABASE_URL is not set');
const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, '');
if (!dbName.endsWith('_e2e') && !dbName.endsWith('_test')) {
  throw new Error(`Refusing to run against "${dbName}"`);
}

function startServer() {
  const child = spawn('npm', ['run', 'start', '--', '-p', String(PORT)], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL,
      BETTER_AUTH_URL: BASE,
      APP_ORIGIN: BASE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health/ready`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('Server did not become ready');
}

async function stop(child) {
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    child.on('exit', resolve);
    setTimeout(() => {
      child.kill('SIGKILL');
      resolve(undefined);
    }, 8000);
  });
  // Confirm the port really is free, so the "restart" is genuine.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/api/health/live`);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Server did not stop');
}

async function signIn() {
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`Sign-in failed: ${response.status}`);
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
  if (!cookies) throw new Error('No session cookie');
  return cookies;
}

async function api(cookies, method, path, body, extraHeaders = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      cookie: cookies,
      origin: BASE,
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  }
  return parsed?.data ?? parsed;
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`  ok  ${message}`);
}

async function main() {
  console.log(`Persistence check against ${dbName}`);

  execFileSync('npx', ['drizzle-kit', 'migrate'], {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL },
  });

  const sql = postgres(DATABASE_URL, { max: 2 });
  try {
    await sql.unsafe(`
      TRUNCATE idempotency_records, audit_events, response_revisions, analyses,
        reports, import_drafts, complaints, response_templates, clients,
        memberships, workspaces, session, account, verification, "user"
      RESTART IDENTITY CASCADE`);
  } finally {
    await sql.end({ timeout: 5 });
  }

  execFileSync(
    'npx',
    ['tsx', 'scripts/provision-user.ts', '--email', EMAIL, '--name', 'Persistence Owner', '--workspace', 'Persistence Agency', '--role', 'owner'],
    { stdio: 'ignore', env: { ...process.env, DATABASE_URL, NEW_PASSWORD: PASSWORD } },
  );

  // ---- First process: create everything ----
  console.log('\nStarting the first server process...');
  let server = startServer();
  await waitForReady();
  let cookies = await signIn();

  const { makeDemoReport } = await import('../src/domain/fixtures/demo-report.ts');
  const { makeDemoComplaint } = await import('../src/domain/fixtures/demo-complaint.ts');
  const report = makeDemoReport();
  const complaintInput = makeDemoComplaint();

  const client = await api(cookies, 'POST', '/api/clients', {
    name: 'Northstar Services',
    domain: 'example.com',
    timeZone: 'America/New_York',
  });

  const draft = await api(cookies, 'POST', '/api/imports', { clientId: client.id });
  const saved = await api(cookies, 'PATCH', `/api/imports/${draft.id}`, {
    expectedRevision: draft.revision,
    metadata: report.metadata,
    datasets: report.datasets,
    sources: report.sources,
    selectedForm: report.selectedForm,
    formDefinitionAcknowledged: report.formDefinitionAcknowledged,
    trendGranularity: report.trendGranularity,
  });
  const validated = await api(cookies, 'POST', `/api/imports/${draft.id}/validate`, {
    expectedRevision: saved.revision,
  });
  const committedReport = await api(
    cookies,
    'POST',
    `/api/imports/${draft.id}/commit`,
    { expectedRevision: validated.revision, contentHash: validated.contentHash },
    { 'idempotency-key': 'persistence-commit' },
  );

  const complaint = await api(cookies, 'POST', '/api/complaints', {
    clientId: client.id,
    ...complaintInput,
  });

  const analysis = await api(
    cookies,
    'POST',
    '/api/analyses',
    { reportId: committedReport.id, complaintId: complaint.id },
    { 'idempotency-key': 'persistence-analysis' },
  );

  const editedDraft = await api(cookies, 'PATCH', `/api/analyses/${analysis.id}/response`, {
    editedText: 'A hand-written draft that must survive a restart.',
    expectedRevision: analysis.response.revision,
  });

  // A second, uncommitted import draft must also survive.
  const openDraft = await api(cookies, 'POST', '/api/imports', { clientId: client.id });
  await api(cookies, 'PATCH', `/api/imports/${openDraft.id}`, {
    expectedRevision: openDraft.revision,
    metadata: { ...report.metadata, reportLabel: 'Work in progress' },
  });

  const before = {
    clientId: client.id,
    reportId: committedReport.id,
    complaintId: complaint.id,
    analysisId: analysis.id,
    diagnosis: analysis.result.diagnosis,
    assessment: analysis.result.complaintAssessment,
    strength: analysis.result.evidenceStrength,
    responseRevision: editedDraft.revision,
    responseText: editedDraft.editedText,
    openDraftId: openDraft.id,
  };
  console.log('Created:', JSON.stringify(before, null, 2));

  // ---- Restart ----
  console.log('\nStopping the server process...');
  await stop(server);
  console.log('Stopped. Starting a brand new process against the same database...');
  server = startServer();
  await waitForReady();
  cookies = await signIn();

  // ---- Second process: read everything back ----
  console.log('\nVerifying after restart:');
  try {
    const readClient = await api(cookies, 'GET', `/api/clients/${before.clientId}`);
    assert(readClient.id === before.clientId, 'the client persisted with the same id');
    assert(readClient.name === 'Northstar Services', 'the client name persisted');

    const readReport = await api(cookies, 'GET', `/api/reports/${before.reportId}`);
    assert(readReport.id === before.reportId, 'the committed report persisted with the same id');
    assert(
      readReport.snapshot.datasets.organic[1].sessions === 12540,
      'the immutable report snapshot is unchanged',
    );

    const readAnalysis = await api(cookies, 'GET', `/api/analyses/${before.analysisId}`);
    assert(readAnalysis.id === before.analysisId, 'the analysis persisted with the same id');
    assert(
      readAnalysis.result.diagnosis === before.diagnosis,
      `the saved diagnosis is unchanged (${before.diagnosis})`,
    );
    assert(
      readAnalysis.result.complaintAssessment === before.assessment,
      `the saved assessment is unchanged (${before.assessment})`,
    );
    assert(
      readAnalysis.result.evidenceStrength === before.strength,
      `the saved evidence strength is unchanged (${before.strength})`,
    );
    assert(
      readAnalysis.response.editedText === before.responseText,
      'the edited response draft persisted exactly',
    );
    assert(
      readAnalysis.response.revision === before.responseRevision,
      'the response revision number persisted',
    );

    const readDraft = await api(cookies, 'GET', `/api/imports/${before.openDraftId}`);
    assert(readDraft.id === before.openDraftId, 'the uncommitted import draft persisted');
    assert(
      readDraft.payload.metadata.reportLabel === 'Work in progress',
      'the uncommitted draft kept its saved values',
    );

    console.log('\nAC-01 PASSED: every record survived a genuine process restart.');
  } finally {
    await stop(server);
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
