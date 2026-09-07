import { betterAuth } from 'better-auth';
import { eq } from 'drizzle-orm';
import { authOptions } from './auth';
import { getDb } from './db/client';
import { memberships, workspaces, responseTemplates, user } from './db/schema';
import { DEFAULT_TEMPLATE_BODY } from '@/domain/render-response';

/**
 * Operator-only account provisioning, used by the CLI scripts.
 *
 * Public sign-up is disabled on the running application. To create the first
 * account the CLI builds a *separate* auth instance with sign-up enabled, so
 * account creation still goes through the library's supported API and this
 * application never hashes a password itself. No HTTP bootstrap endpoint
 * exists, so this path is not reachable from a browser.
 */
function provisioningAuth() {
  return betterAuth(
    authOptions({
      emailAndPassword: { enabled: true, disableSignUp: false, minPasswordLength: 12 },
      rateLimit: { enabled: false },
    }),
  );
}

export async function provisionUser(input: {
  email: string;
  name: string;
  password: string;
  role: 'owner' | 'analyst';
  workspaceName?: string;
  workspaceId?: string;
}): Promise<{ userId: string; workspaceId: string }> {
  const db = getDb();

  if (!input.workspaceId && !input.workspaceName) {
    throw new Error('Provide either --workspace <name> to create one, or --workspace-id <uuid>');
  }

  let workspaceId = input.workspaceId ?? null;
  if (workspaceId) {
    const found = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (found.length === 0) throw new Error(`No workspace with id ${workspaceId}`);
  }

  const auth = provisioningAuth();
  const signUp = await auth.api.signUpEmail({
    body: { email: input.email, password: input.password, name: input.name },
  });
  const userId = signUp.user.id;

  if (!workspaceId) {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: input.workspaceName! })
      .returning();
    workspaceId = workspace.id;

    // Every workspace starts with a usable default template, so the first
    // analysis can always render a response.
    await db.insert(responseTemplates).values({
      workspaceId,
      name: 'Default response',
      body: DEFAULT_TEMPLATE_BODY,
      isDefault: 'true',
      createdBy: userId,
      updatedBy: userId,
    });
  }

  await db.insert(memberships).values({ userId, workspaceId, role: input.role, active: 'true' });
  return { userId, workspaceId };
}

export async function setPassword(email: string, password: string): Promise<void> {
  const db = getDb();
  const found = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (found.length === 0) throw new Error(`No user with email ${email}`);

  const auth = provisioningAuth();
  const context = await auth.$context;
  // The library's own hashing, then every existing session is revoked.
  await context.internalAdapter.updatePassword(found[0].id, await context.password.hash(password));
  await context.internalAdapter.deleteUserSessions(found[0].id);
}

export async function setMembershipActive(email: string, active: boolean): Promise<void> {
  const db = getDb();
  const found = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (found.length === 0) throw new Error(`No user with email ${email}`);
  await db
    .update(memberships)
    .set({ active: active ? 'true' : 'false' })
    .where(eq(memberships.userId, found[0].id));

  if (!active) {
    const auth = provisioningAuth();
    const context = await auth.$context;
    await context.internalAdapter.deleteUserSessions(found[0].id);
  }
}
