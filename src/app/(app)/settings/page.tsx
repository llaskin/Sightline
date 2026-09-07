import { pageMembership } from '@/server/page-data';
import { readSettings } from '@/server/repositories/settings';
import { SettingsForm } from '@/features/settings/settings-form';

export const dynamic = 'force-dynamic';

/**
 * The profile shown here is the signed-in membership itself, read through the
 * same code path the API uses, so the screen cannot show a role or a workspace
 * the session does not actually hold.
 */
export default async function SettingsPage() {
  const membership = await pageMembership();
  const settings = await readSettings(membership);

  return <SettingsForm initial={settings} />;
}
