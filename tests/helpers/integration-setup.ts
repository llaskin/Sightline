import './load-env';
import { assertTestDatabaseUrl, assertDistinctFromDevelopmentDatabase } from './database';

// Every module that reads DATABASE_URL inside the application must see the
// isolated test database, and only after the _test guard has passed.
// Checked while DATABASE_URL still names the development database.
assertDistinctFromDevelopmentDatabase();
const url = assertTestDatabaseUrl();
process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET ??= 'integration-test-secret-value-at-least-32-chars';
process.env.BETTER_AUTH_URL ??= 'http://localhost:3100';
process.env.APP_ORIGIN ??= 'http://localhost:3100';
