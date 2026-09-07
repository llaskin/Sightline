import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} must be set to run the browser suite. It is the isolated ` +
        'database the suite resets and reseeds; there is no fallback, because ' +
        'a default would point the run at whichever database happened to be ' +
        'configured.',
    );
  }
  return value;
}

const PORT = Number(process.env.E2E_PORT ?? 3110);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: 'production',
      E2E: '1',
      // The server under test points at the isolated browser database, never
      // at the development one. Both are required rather than defaulted: an
      // empty string here starts a server that fails on every request with
      // "DATABASE_URL is not configured", three minutes later, as a webServer
      // timeout that says nothing about the cause. That is how the first CI
      // run failed.
      DATABASE_URL: required('E2E_DATABASE_URL'),
      BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET'),
      BETTER_AUTH_URL: baseURL,
      APP_ORIGIN: baseURL,
    },
  },
});
