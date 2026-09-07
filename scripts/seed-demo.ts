import './load-env';
import { refuseInProduction, args, required } from './cli-support';
import { getDb } from '../src/server/db/client';
import { clients, complaints, reports, analyses, responseRevisions, responseTemplates } from '../src/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { makeDemoReport, DEMO_NOW, DEMO_CLIENT_NAME, DEMO_CLIENT_DOMAIN, DEMO_TIME_ZONE } from '../src/domain/fixtures/demo-report';
import { makeDemoComplaint } from '../src/domain/fixtures/demo-complaint';
import { analyzeReport } from '../src/domain/analyze';
import { renderResponse, DEFAULT_TEMPLATE_BODY } from '../src/domain/render-response';
import { RULE_VERSION, RESULT_SCHEMA_VERSION } from '../src/domain/analysis-schema';
import { createHash } from 'node:crypto';

/**
 * Loads the fictional demo client into a *development* workspace.
 *
 * Refused when NODE_ENV=production: seeded content must never appear in a real
 * agency workspace. Re-running is idempotent - it finds the existing demo
 * client by name and domain rather than creating a duplicate.
 *
 *   npm run seed:demo -- --workspace-id <uuid>
 */
async function main() {
  refuseInProduction('Seeding demo data');
  const values = args();
  const workspaceId = required(values, 'workspace-id');
  const db = getDb();

  const existing = await db
    .select()
    .from(clients)
    .where(and(eq(clients.workspaceId, workspaceId), eq(clients.name, DEMO_CLIENT_NAME)))
    .limit(1);

  if (existing[0]) {
    console.log(`Demo client already present (${existing[0].id}). Nothing to do.`);
    process.exit(0);
  }

  const [client] = await db
    .insert(clients)
    .values({
      workspaceId,
      name: DEMO_CLIENT_NAME,
      domain: DEMO_CLIENT_DOMAIN,
      timeZone: DEMO_TIME_ZONE,
      definitions: {
        propertyLabel: `${DEMO_CLIENT_NAME} — ${DEMO_CLIENT_DOMAIN}`,
        leadDefinition: 'Sessions containing the contact form submission key event',
        leadEventName: 'generate_lead',
        defaultWindowDays: 30,
      },
    })
    .returning();

  const report = makeDemoReport();
  const [reportRow] = await db
    .insert(reports)
    .values({
      workspaceId,
      clientId: client.id,
      schemaVersion: 1,
      reportLabel: report.metadata.reportLabel,
      snapshot: report,
      contentHash: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
      createdBy: 'seed',
    })
    .returning();

  const complaintInput = makeDemoComplaint();
  const [complaintRow] = await db
    .insert(complaints)
    .values({
      workspaceId,
      clientId: client.id,
      originalText: complaintInput.originalText,
      category: complaintInput.category,
      scope: complaintInput.scope,
      periodStart: complaintInput.periodStart,
      periodEnd: complaintInput.periodEnd,
      receivedAt: new Date(complaintInput.receivedAt),
      status: 'analyzed',
      createdBy: 'seed',
    })
    .returning();

  // The real engine, not a stored result: the seed must exercise the same path.
  const result = analyzeReport(report, complaintInput, {
    now: new Date(DEMO_NOW),
    ruleVersion: RULE_VERSION,
  });

  const [analysis] = await db
    .insert(analyses)
    .values({
      workspaceId,
      clientId: client.id,
      reportId: reportRow.id,
      complaintId: complaintRow.id,
      complaintSnapshot: complaintInput,
      ruleVersion: RULE_VERSION,
      resultSchemaVersion: RESULT_SCHEMA_VERSION,
      result,
      diagnosis: result.diagnosis,
      createdBy: 'seed',
    })
    .returning();

  const [template] = await db
    .select()
    .from(responseTemplates)
    .where(and(eq(responseTemplates.workspaceId, workspaceId), eq(responseTemplates.isDefault, 'true')))
    .limit(1);

  const { generatedText, templateSnapshot } = renderResponse({
    template: template
      ? { id: template.id, name: template.name, body: template.body }
      : { id: 'default', name: 'Default response', body: DEFAULT_TEMPLATE_BODY },
    context: { clientName: client.name, agencyName: 'Your Agency', senderName: 'Demo Analyst' },
    report,
    complaint: complaintInput,
    result,
  });

  await db.insert(responseRevisions).values({
    workspaceId,
    analysisId: analysis.id,
    revision: 1,
    templateSnapshot,
    generatedText,
    editedText: null,
    createdBy: 'seed',
  });

  console.log('Seeded the fictional demo client.');
  console.log(`  client   ${client.id}  ${DEMO_CLIENT_NAME} (${DEMO_CLIENT_DOMAIN})`);
  console.log(`  report   ${reportRow.id}`);
  console.log(`  analysis ${analysis.id}  diagnosis=${result.diagnosis}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
