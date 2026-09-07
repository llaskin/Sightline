import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from './db/client';
import * as schema from './db/schema';

/**
 * Email and password sign-in with **public sign-up disabled**. Release 1 has no
 * public registration, no invitations and no self-service password recovery;
 * accounts are created by an operator through the CLI.
 *
 * Password hashing, verification and session handling are entirely the
 * library's. This application implements no password cryptography of its own.
 */

export function authOptions(overrides: Partial<BetterAuthOptions> = {}): BetterAuthOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    database: drizzleAdapter(getDb(), { provider: 'pg', schema }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: [process.env.APP_ORIGIN ?? 'http://localhost:3100'],
    emailAndPassword: {
      enabled: true,
      // No public registration surface exists in release 1.
      disableSignUp: true,
      minPasswordLength: 12,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      // Secure, host-only, same-site cookies in production.
      useSecureCookies: isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 10,
    },
    ...overrides,
  };
}

let cached: ReturnType<typeof betterAuth> | null = null;

export function getAuth() {
  if (!cached) cached = betterAuth(authOptions());
  return cached;
}

export type AppSession = {
  userId: string;
  email: string;
  name: string;
};

/** Reads the session from request headers. Never from a body or query string. */
export async function getSessionFromHeaders(headers: Headers): Promise<AppSession | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result?.user) return null;
  return { userId: result.user.id, email: result.user.email, name: result.user.name };
}
