import { config } from 'dotenv';

/**
 * Loads local configuration for tests and CLI scripts. `.env.local` takes
 * precedence over `.env`, matching how Next.js resolves them, and neither
 * overwrites a value already present in the real environment (so CI wins).
 */
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
