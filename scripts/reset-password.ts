import './load-env';
import { args, required, readPassword } from './cli-support';
import { setPassword, setMembershipActive } from '../src/server/provisioning';

/**
 * Sets a new password, or activates/deactivates a membership. Both revoke the
 * user's existing sessions.
 *
 *   npm run reset:password -- --email a@b.com
 *   npm run reset:password -- --email a@b.com --deactivate
 *   npm run reset:password -- --email a@b.com --activate
 */
async function main() {
  const values = args();
  const email = required(values, 'email');

  if (values.deactivate === 'true') {
    await setMembershipActive(email, false);
    console.log(`Deactivated ${email} and revoked their sessions.`);
    process.exit(0);
  }
  if (values.activate === 'true') {
    await setMembershipActive(email, true);
    console.log(`Reactivated ${email}.`);
    process.exit(0);
  }

  await setPassword(email, await readPassword());
  console.log(`Password updated for ${email}. All their sessions were revoked.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
