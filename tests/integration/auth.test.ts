import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getAuth } from '@/server/auth';
import { requireMembership, requireOwner, UnauthenticatedError, ForbiddenError } from '@/server/require-membership';
import { setMembershipActive, setPassword } from '@/server/provisioning';
import { resetDatabase, closeDatabase } from '../helpers/database';
import { addAnalyst, createWorkspaceWithOwner, signIn } from '../helpers/auth';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe('sign-in', () => {
  it('signs a provisioned owner in and resolves their workspace', async () => {
    const owner = await createWorkspaceWithOwner('Northstar Agency');
    const context = await requireMembership(owner.headers);
    expect(context.userId).toBe(owner.userId);
    expect(context.workspaceId).toBe(owner.workspaceId);
    expect(context.role).toBe('owner');
    expect(context.workspaceName).toBe('Northstar Agency');
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const owner = await createWorkspaceWithOwner();
    const response = await getAuth().api.signInEmail({
      body: { email: owner.email, password: 'not-the-right-password' },
      asResponse: true,
    });
    expect(response.ok).toBe(false);
    const body = await response.text();
    expect(body.toLowerCase()).not.toContain('no such user');
    expect(body.toLowerCase()).not.toContain('user not found');
  });

  it('rejects an unknown email the same way', async () => {
    const response = await getAuth().api.signInEmail({
      body: { email: 'nobody@example.com', password: 'correct-horse-battery-staple' },
      asResponse: true,
    });
    expect(response.ok).toBe(false);
  });
});

describe('public sign-up', () => {
  it('is disabled, so the sign-up endpoint cannot create an account', async () => {
    const response = await getAuth().api.signUpEmail({
      body: {
        email: 'intruder@example.com',
        password: 'correct-horse-battery-staple',
        name: 'Intruder',
      },
      asResponse: true,
    });
    expect(response.ok).toBe(false);
    // And no session was issued.
    expect(response.headers.getSetCookie().length).toBe(0);
  });

  it('leaves no user row behind after a rejected sign-up', async () => {
    await getAuth()
      .api.signUpEmail({
        body: { email: 'intruder2@example.com', password: 'correct-horse-battery-staple', name: 'X' },
        asResponse: true,
      })
      .catch(() => undefined);
    await expect(signIn('intruder2@example.com', 'correct-horse-battery-staple')).rejects.toThrow();
  });
});

describe('membership enforcement', () => {
  it('refuses a request with no session', async () => {
    await expect(requireMembership(new Headers())).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('refuses a request with a fabricated session cookie', async () => {
    const headers = new Headers({ cookie: 'better-auth.session_token=not-a-real-token' });
    await expect(requireMembership(headers)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('revokes effective access when a membership is deactivated', async () => {
    const owner = await createWorkspaceWithOwner();
    const analyst = await addAnalyst(owner.workspaceId);
    // The session works while the membership is active.
    await expect(requireMembership(analyst.headers)).resolves.toMatchObject({ role: 'analyst' });

    await setMembershipActive(analyst.email, false);

    // The same cookie now resolves to no workspace at all.
    await expect(requireMembership(analyst.headers)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('never reads a workspace from anything the caller supplies', async () => {
    const first = await createWorkspaceWithOwner('First Agency');
    const second = await createWorkspaceWithOwner('Second Agency');
    expect(first.workspaceId).not.toBe(second.workspaceId);

    // Headers that try to assert another workspace are simply ignored.
    const headers = new Headers(first.headers);
    headers.set('x-workspace-id', second.workspaceId);
    headers.set('workspace', second.workspaceId);
    const context = await requireMembership(headers);
    expect(context.workspaceId).toBe(first.workspaceId);
  });
});

describe('roles', () => {
  it('allows an owner and refuses an analyst for owner-only actions', async () => {
    const owner = await createWorkspaceWithOwner();
    const analyst = await addAnalyst(owner.workspaceId);

    const ownerContext = await requireMembership(owner.headers);
    expect(() => requireOwner(ownerContext)).not.toThrow();

    const analystContext = await requireMembership(analyst.headers);
    expect(() => requireOwner(analystContext)).toThrow(ForbiddenError);
  });
});

describe('password reset', () => {
  it('sets a new password and revokes the existing sessions', async () => {
    const owner = await createWorkspaceWithOwner();
    await expect(requireMembership(owner.headers)).resolves.toBeTruthy();

    await setPassword(owner.email, 'a-completely-different-password');

    // The old cookie no longer resolves.
    await expect(requireMembership(owner.headers)).rejects.toBeInstanceOf(UnauthenticatedError);
    // The old password no longer works, the new one does.
    await expect(signIn(owner.email, owner.password)).rejects.toThrow();
    await expect(signIn(owner.email, 'a-completely-different-password')).resolves.toBeTruthy();
  });
});
