import { eq, and } from 'drizzle-orm';
import { getDb } from './db/client';
import { memberships, workspaces } from './db/schema';
import { getSessionFromHeaders } from './auth';

/**
 * The only place a workspace identity is established.
 *
 * The workspace is derived from an *active membership* of the signed-in user.
 * It is never read from a request body, a query parameter, a header, a cookie
 * this application invented, or anything a client component can influence. A
 * deactivated membership loses access immediately, even if the session cookie
 * is still valid and unexpired.
 */

export type MembershipContext = {
  userId: string;
  userName: string;
  userEmail: string;
  workspaceId: string;
  workspaceName: string;
  role: 'owner' | 'analyst';
};

export class UnauthenticatedError extends Error {
  constructor() {
    super('No active session');
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Your role does not allow this action') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export async function requireMembership(headers: Headers): Promise<MembershipContext> {
  const session = await getSessionFromHeaders(headers);
  if (!session) throw new UnauthenticatedError();

  const rows = await getDb()
    .select({
      workspaceId: memberships.workspaceId,
      role: memberships.role,
      active: memberships.active,
      workspaceName: workspaces.name,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(memberships.userId, session.userId), eq(memberships.active, 'true')))
    .limit(1);

  const membership = rows[0];
  // A signed-in user with no active membership has no workspace and therefore
  // no access, rather than a default or empty workspace.
  if (!membership) throw new UnauthenticatedError();

  return {
    userId: session.userId,
    userName: session.name,
    userEmail: session.email,
    workspaceId: membership.workspaceId,
    workspaceName: membership.workspaceName,
    role: membership.role,
  };
}

/** Owner-only mutations: templates, settings, archiving and deletion. */
export function requireOwner(context: MembershipContext): void {
  if (context.role !== 'owner') {
    throw new ForbiddenError('Only a workspace owner can change this');
  }
}
