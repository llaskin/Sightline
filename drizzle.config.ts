import './scripts/load-env';
import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are generated and reviewed as SQL, then applied as a deliberate
 * release step. No web process applies migrations on boot.
 */
export default defineConfig({
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
