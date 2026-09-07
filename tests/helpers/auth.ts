import { getAuth } from '@/server/auth';
import { provisionUser } from '@/server/provisioning';
import { TEST_ORIGIN } from './origin';

/**
 * Provisions real users and signs them in through the real auth library, so
 * integration tests exercise the actual session path rather than a stub.
 */

export type TestUser = {
  userId: string;
  workspaceId: string;
  email: string;
  password: string;
  role: 'owner' | 'analyst';
  /** Headers carrying a genuine session cookie. */
  headers: Headers;
};

let counter = 0;

export async function createWorkspaceWithOwner(
  workspaceName = 'Test Agency',
): Promise<TestUser> {
  counter += 1;
  const email = `owner-${counter}-${Date.now()}@example.com`;
  const password = 'correct-horse-battery-staple';
  const { userId, workspaceId } = await provisionUser({
    email,
    name: 'Test Owner',
    password,
    role: 'owner',
    workspaceName,
  });
  return { userId, workspaceId, email, password, role: 'owner', headers: await signIn(email, password) };
}

export async function addAnalyst(workspaceId: string): Promise<TestUser> {
  counter += 1;
  const email = `analyst-${counter}-${Date.now()}@example.com`;
  const password = 'correct-horse-battery-staple';
  const { userId } = await provisionUser({
    email,
    name: 'Test Analyst',
    password,
    role: 'analyst',
    workspaceId,
  });
  return {
    userId,
    workspaceId,
    email,
    password,
    role: 'analyst',
    headers: await signIn(email, password),
  };
}

/** Signs in and returns headers with the resulting session cookie. */
export async function signIn(email: string, password: string): Promise<Headers> {
  const response = await getAuth().api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  if (!response.ok) {
    throw new Error(`Sign-in failed with status ${response.status}`);
  }
  const setCookie = response.headers.getSetCookie();
  if (setCookie.length === 0) throw new Error('Sign-in returned no session cookie');
  const headers = new Headers();
  headers.set('cookie', setCookie.map((cookie) => cookie.split(';')[0]).join('; '));
  return headers;
}

/** Headers for a mutating request from the trusted application origin. */
export function mutating(user: TestUser): Headers {
  const headers = new Headers(user.headers);
  headers.set('origin', TEST_ORIGIN);
  headers.set('content-type', 'application/json');
  return headers;
}
