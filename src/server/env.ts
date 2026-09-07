import { z } from 'zod';

/**
 * Server-only environment access. Importing this from a client component is a
 * build error, which keeps secrets out of the browser bundle.
 */
import 'server-only';

const schema = z.object({
  DATABASE_URL: z.string().min(1, { error: 'DATABASE_URL is required' }),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, { error: 'BETTER_AUTH_SECRET must be at least 32 characters' }),
  BETTER_AUTH_URL: z.url({ error: 'BETTER_AUTH_URL must be a URL' }),
  APP_ORIGIN: z.url({ error: 'APP_ORIGIN must be a URL' }),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Names only. Values are never logged, because they are secrets.
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid server environment configuration: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
