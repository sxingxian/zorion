import { expect, test } from '@playwright/test';
import { ADMIN_KEY } from './playwright.config';
import { SITE, signIn, tap, totp } from './helpers';

test.use({ viewport: { width: 1280, height: 800 } });

test('landing page: headline, the 3D map where routes meet, plans from the admin, and no page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(SITE);
  await expect(page.getByRole('heading', { level: 1, name: 'Meet in the middle.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start a meetup, free' }).first()).toHaveAttribute('href', 'http://localhost:5173');
  await expect(page.locator('.lp-hero.is3d .lp-city canvas')).toBeVisible({ timeout: 15_000 }); // the 3D city replaced the drawn map
  await expect(page.getByRole('heading', { name: 'Zorion finds the fair middle.' })).toBeVisible();
  await expect(page.locator('.lp-table')).toContainText('Up to 30');
  await expect(page.locator('ins.adsbygoogle')).toHaveCount(0); // no Google ads on the landing page
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('landing page on a phone shows the map under the words, and with reduced motion loads no animation code', async ({ browser }) => {
  const page = await (await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } })).newPage();
  const scripts: string[] = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await page.goto(SITE);
  await page.waitForTimeout(1500);
  await expect(page.locator('.lp-hero-mobile .lp-plan')).toBeVisible(); // the drawn plan of the same city
  await expect(page.locator('.lp-city canvas')).toHaveCount(0);
  await expect(page.locator('.lp-hero-map')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(scripts.some((u) => /gsap|lenis|hero3d/.test(u))).toBe(false);
});

test('a missing page on the site shows Zorion\'s own page', async ({ page }) => {
  await page.goto(`${SITE}/nope`);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Zorion' })).toHaveAttribute('href', '/');
});

test('privacy and terms pages say what the app does', async ({ page }) => {
  await page.goto(`${SITE}/privacy`);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
  await expect(page.getByText('On the crew map, others see only a rough area', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: "Google's Ads Settings" })).toHaveAttribute('href', 'https://adssettings.google.com/');
  await page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Terms' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Terms' })).toBeVisible();
  await page.goto(SITE);
  await expect(page.locator('.lp-close a[href="/privacy"]')).toBeVisible();
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
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  // The overview: this week's numbers, services, what needs you, recent activity.
  await expect(page.getByText('Meetups made per day')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();

  await page.getByRole('link', { name: 'Maps', exact: true }).click();
  await page.getByLabel('Trip times come from').selectOption('google');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page.getByLabel('Google key')).toBeVisible(); // the key field appears under the choice that needs it
  await expect(page.getByText('Until a key is connected, Zorion uses the free services.')).toBeVisible();
  await expect(page.getByLabel('Order Zorion tries')).toContainText("OpenStreetMap routing → Zorion's estimate"); // Google is skipped until its key is connected
  await expect(page.getByRole('heading', { name: 'Free services' })).toBeVisible();
  await expect(page.getByLabel('OneMap email')).toBeVisible();
  await page.getByLabel('Trip times come from').selectOption('estimate'); // leave the demo as it was
  await expect(page.getByRole('heading', { name: 'Map tiles' })).toBeVisible();
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('Changed trip times to Google routes').first()).toBeVisible(); // the log reads in plain words
  await expect(page.getByText(/^1–\d+ of \d+$/)).toBeVisible(); // paged

  // Keys: a missing key is said under the field, and the authenticator code is asked when Connect is pressed.
  await page.getByRole('link', { name: 'Payments', exact: true }).click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('Paste the secret key first.')).toBeVisible();
  await page.getByLabel('Secret key').fill(['sk', 'test', 'abcdefghijklmnopqrstuv'].join('_'));
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect Stripe' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Without a session the admin API gives nothing away.
  const res = await (await page.context().browser()!.newContext()).request.get(`${SITE}/admin/api/users`);
  expect(res.status()).toBe(401);
});

test('admin: prices and categories set in the portal show up in the app', async ({ page, browser }) => {
  await page.goto(`${SITE}/admin`);
  await page.locator('input[type=email]').fill('admin@example.com');
  await page.locator('input[type=password]').fill('demo-admin-password');
  await tap(page, 'Continue');
  await page.locator('input[inputmode=numeric]').fill(totp(ADMIN_KEY, Date.now() + 30_000));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Plans', exact: true }).click();
  const monthly = page.getByLabel('Monthly', { exact: true });
  await monthly.fill('1.0'); // what you type stays as typed while you type
  await expect(monthly).toHaveValue('1.0');
  await monthly.fill('4.90');
  await page.getByLabel('Yearly', { exact: true }).fill('49');
  await page.getByLabel('Yearly', { exact: true }).blur();
  await expect(page.getByLabel('Yearly', { exact: true })).toHaveValue('49.00'); // tidied on leaving the box
  await expect(page.getByText('Yearly is 17% cheaper than 12 months of monthly.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Categories', exact: true }).click();
  await page.getByRole('button', { name: 'Add food option' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Hotpot');
  await page.getByRole('button', { name: 'hotpot', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByLabel('Google search words')).toBeVisible();
  await page.getByRole('button', { name: 'Use one set of search words' }).click();
  await page.getByLabel('Search words', { exact: true }).fill('hotpot, steamboat');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Hotpot', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page.getByText(/Changed plans · Pro S\$4\.90 a month/).first()).toBeVisible();
  await page.goto(`${SITE}/admin/nope`);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

  const app = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const config = await (await app.request.get('http://localhost:5173/api/config')).json();
  expect(config.plans.price).toMatchObject({ monthly: 490, yearly: 4900 });
  const cats = await (await app.request.get('http://localhost:5173/api/categories')).json();
  expect(cats.categories.map((c: { name: string }) => c.name)).toContain('Hotpot');
  await app.goto('http://localhost:5173/nope');
  await expect(app.getByRole('heading', { name: 'Page not found' })).toBeVisible();

  // Giving Pro: the host shows as given Pro in the portal, and their Account says until when.
  await signIn(app, 'given-pro@example.com');
  await page.goto(`${SITE}/admin/users`);
  await page.getByLabel('Search hosts').fill('given-pro');
  await page.getByRole('button', { name: /given-pro@example\.com/ }).click();
  await page.getByRole('button', { name: 'Give Pro', exact: true }).click();
  await page.getByRole('button', { name: '3 months', exact: true }).click();
  await page.getByLabel('Note for the log').fill('Launch helper');
  await page.getByRole('button', { name: 'Give Pro', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Pro given');
  await page.getByRole('button', { name: /given-pro@example\.com/ }).click();
  await expect(page.getByText(/^Pro · given until /)).toBeVisible();
  await expect(page.getByText('Launch helper')).toBeVisible();
  await app.goto('http://localhost:5173/account');
  await expect(app.getByText(/^Given until /)).toBeVisible();
  await expect(app.getByRole('button', { name: 'Manage' })).toHaveCount(0);
});
