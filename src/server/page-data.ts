import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireMembership, UnauthenticatedError, type MembershipContext } from './require-membership';

/**
 * Server-rendered pages resolve membership through exactly the same code path
 * as the API handlers. There is no separate, weaker check for page reads.
 */
export async function pageMembership(): Promise<MembershipContext> {
  try {
    return await requireMembership(await headers());
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/login');
    throw error;
  }
}
