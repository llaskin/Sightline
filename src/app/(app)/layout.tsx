import { AppShell } from '@/components/app-shell';
import { pageMembership } from '@/server/page-data';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const membership = await pageMembership();
  return (
    <AppShell
      user={{
        name: membership.userName,
        role: membership.role,
        workspaceName: membership.workspaceName,
      }}
    >
      {children}
    </AppShell>
  );
}
