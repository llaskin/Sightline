import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * One pooled connection per process. Node runtime only; these handlers are not
 * eligible for the Edge runtime because they open a TCP database connection.
 */

declare global {
   
  var __excuseDetectorDb: ReturnType<typeof createDb> | undefined;
}

function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 10, prepare: false });
  return drizzle(client, { schema });
}

export function getDb() {
  if (!globalThis.__excuseDetectorDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not configured');
    globalThis.__excuseDetectorDb = createDb(url);
  }
  return globalThis.__excuseDetectorDb;
}

export type Db = ReturnType<typeof getDb>;
export type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
