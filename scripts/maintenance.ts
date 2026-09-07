import './load-env';
import { args } from './cli-support';
import { applyRetention, retentionPreview, expireDrafts } from '../src/server/services/retention';

/**
 * Daily maintenance, run by the host scheduler.
 *
 *   npm run maintenance -- --dry-run   report counts, change nothing
 *   npm run maintenance -- --apply     apply retention and draft expiry
 *
 * The database comes from DATABASE_URL only. There is deliberately no fallback
 * to TEST_DATABASE_URL, so maintenance can never be pointed at a test database
 * by accident, nor a test run at production data.
 */
async function main() {
  const values = args();
  const dryRun = values['dry-run'] === 'true';
  const apply = values.apply === 'true';

  if (dryRun === apply) {
    console.error('Choose exactly one of --dry-run or --apply.');
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(2);
  }
  if (process.env.DATABASE_URL === process.env.TEST_DATABASE_URL) {
    console.error('DATABASE_URL matches TEST_DATABASE_URL. Refusing to run.');
    process.exit(2);
  }

  const now = new Date();
  console.log(`Maintenance ${dryRun ? 'dry run' : 'apply'} at ${now.toISOString()}`);

  if (dryRun) {
    const retention = await retentionPreview({ now });
    const drafts = await expireDrafts({ now, dryRun: true });
    console.log('Would delete:');
    console.log(`  analyses            ${retention.analysesDeleted}`);
    console.log(`  reports             ${retention.reportsDeleted}`);
    console.log(`  idempotency records ${retention.idempotencyRecordsDeleted}`);
    console.log(`  expired drafts      ${drafts.draftsDeleted}`);
    console.log('Nothing was changed.');
    process.exit(0);
  }

  const retention = await applyRetention({ now });
  const drafts = await expireDrafts({ now });
  console.log('Deleted:');
  console.log(`  analyses            ${retention.analysesDeleted}`);
  console.log(`  reports             ${retention.reportsDeleted}`);
  console.log(`  idempotency records ${retention.idempotencyRecordsDeleted}`);
  console.log(`  expired drafts      ${drafts.draftsDeleted}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
