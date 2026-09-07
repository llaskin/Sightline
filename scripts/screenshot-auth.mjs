/**
 * Signs in with a real session and captures the authenticated dashboard at a
 * given viewport. Used to check the recreated layout against the reference.
 */
import { chromium } from '@playwright/test';

const [base, email, password, path, out, w, h, full] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: Number(w), height: Number(h) } });
const page = await context.newPage();

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(/\/(dashboard|analyses)/, { timeout: 20000 });
await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.screenshot({ path: out, fullPage: full === 'full' });

const overflow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  url: location.pathname,
}));
console.log(JSON.stringify({ out, ...overflow, overflows: overflow.scrollWidth > overflow.clientWidth + 1 }));
await browser.close();
