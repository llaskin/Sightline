import { pageMembership } from '@/server/page-data';
import { listTemplates, toTemplateView } from '@/server/repositories/templates';
import { TemplateEditor } from '@/features/templates/template-editor';

export const dynamic = 'force-dynamic';

/**
 * Templates are read through the repository on the server, so the first paint
 * shows the stored wording rather than a loading state that fetches it again.
 */
export default async function TemplatesPage() {
  const membership = await pageMembership();
  const templates = (await listTemplates(membership)).map(toTemplateView);

  return <TemplateEditor initialTemplates={templates} role={membership.role} />;
}
