import './load-env';
import { args, required, readPassword } from './cli-support';
import { provisionUser } from '../src/server/provisioning';

/**
 * Creates an agency user. There is no HTTP bootstrap endpoint and no seeded
 * password: an operator runs this deliberately.
 *
 *   npm run provision:user -- --email a@b.com --name "A B" --workspace "Agency" --role owner
 *   npm run provision:user -- --email c@d.com --name "C D" --workspace-id <uuid> --role analyst
 */
async function main() {
  const values = args();
  const role = (values.role ?? 'owner') as 'owner' | 'analyst';
  if (role !== 'owner' && role !== 'analyst') {
    console.error('--role must be owner or analyst');
    process.exit(2);
  }
  const password = await readPassword();

  const result = await provisionUser({
    email: required(values, 'email'),
    name: required(values, 'name'),
    password,
    role,
    workspaceName: values.workspace,
    workspaceId: values['workspace-id'],
  });

  console.log('Provisioned.');
  console.log(`  user id      ${result.userId}`);
  console.log(`  workspace id ${result.workspaceId}`);
  console.log(`  role         ${role}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
