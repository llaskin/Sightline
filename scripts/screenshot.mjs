/**
 * Captures a viewport screenshot and reports whether the *document* overflows
 * horizontally. A table scrolling inside its own card is fine; the page body
 * scrolling sideways is not.
 */
import { chromium } from '@playwright/test';

const [url, out, w, h, full] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
await page.screenshot({ path: out, fullPage: full === 'full' });
const overflow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
console.log(
  JSON.stringify({ out, ...overflow, overflows: overflow.scrollWidth > overflow.clientWidth + 1 }),
);
await browser.close();
