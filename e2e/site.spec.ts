import { expect, test } from '@playwright/test';
import { ADMIN_KEY } from './playwright.config';
import { SITE, tap, totp } from './helpers';

test.use({ viewport: { width: 1280, height: 800 } });

test('landing page: headline, the 3D hero or its drawn fallback, and no page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(SITE);
  await expect(page.getByRole('heading', { level: 1, name: 'Good fortune, fair walk.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Host a meetup, free' }).first()).toHaveAttribute('href', 'http://localhost:5173');
  // Either the 3D scene took over, or the drawn map is still showing. Never neither.
  await page.waitForTimeout(2500);
  const is3d = await page.locator('.hero.is3d canvas').count();
  if (is3d) await expect(page.locator('.hero.is3d canvas')).toBeVisible();
  else await expect(page.locator('.hero svg.city')).toBeVisible();
  await expect(page.locator('.hero .walker')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('landing page with reduced motion keeps the drawn map and loads no 3D', async ({ browser }) => {
  const page = await (await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } })).newPage();
  const scripts: string[] = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await page.goto(SITE);
  await page.waitForTimeout(1500);
  await expect(page.locator('.hero svg.city')).toBeVisible();
  await expect(page.locator('.hero canvas')).toHaveCount(0);
  expect(scripts.some((u) => /hero3d|gsap|lenis/.test(u))).toBe(false);
});

test('privacy and terms pages say what the app does', async ({ page }) => {
  await page.goto(`${SITE}/privacy`);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
  await expect(page.getByText('It is never shown or sent to anyone else in the meetup, including the host.')).toBeVisible();
  await expect(page.getByRole('link', { name: "Google's Ads Settings" })).toHaveAttribute('href', 'https://adssettings.google.com/');
  await page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Terms' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Terms' })).toBeVisible();
  await page.goto(SITE);
  await expect(page.locator('footer a[href="/privacy"]')).toBeVisible();
});

test('admin: password, then authenticator; a setting change lands in the audit log', async ({ page }) => {
  await page.goto(`${SITE}/admin`);
  await page.locator('input[type=email]').fill('admin@example.com');
  await page.locator('input[type=password]').fill('not-the-password');
  await tap(page, 'Continue');
  await expect(page.getByRole('alert')).toHaveText('That did not match.');
  await page.locator('input[type=password]').fill('demo-admin-password');
  await tap(page, 'Continue');
  await page.locator('input[inputmode=numeric]').fill(totp(ADMIN_KEY));
  await tap(page, 'Verify and sign in');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.getByRole('link', { name: 'Categories & rules' }).click();
  await page.getByLabel('Trip times come from').selectOption('google');
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.getByLabel('Trip times come from').selectOption('estimate'); // leave the demo as it was
  await page.getByRole('link', { name: 'Access & audit' }).click();
  await expect(page.getByText('routing_provider').first()).toBeVisible();

  // Without a session the admin API gives nothing away.
  const res = await (await page.context().browser()!.newContext()).request.get(`${SITE}/admin/api/users`);
  expect(res.status()).toBe(401);
});
