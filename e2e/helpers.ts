import { createHmac } from 'node:crypto';
import { type Browser, type Page, expect } from '@playwright/test';

export const APP = 'http://localhost:5173';
export const SITE = 'http://localhost:5174';

/** Clicks the button whose whole label is exactly this text. */
export async function press(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).locator('visible=true').first().click();
}

/** Clicks the first button or link that contains the text. */
export async function tap(page: Page, text: string | RegExp): Promise<void> {
  await page.locator('button:visible, a:visible, [role=button]:visible, [role=radio]:visible').filter({ hasText: text }).first().click();
}

/** Types into the boxed code inputs (sign-in codes, guest codes). */
export async function typeCode(page: Page, code: string): Promise<void> {
  await page.locator('input[aria-label="Character 1"]').click();
  await page.keyboard.type(code);
}

/** The newest sign-in code "emailed" to this address. The demo keeps emails in memory instead of sending them. */
export async function emailedCode(page: Page, email: string): Promise<string> {
  const { outbox } = await (await page.request.get(`${APP}/api/dev/outbox`)).json();
  const mail = [...outbox].reverse().find((m: { to: string }) => m.to === email);
  return mail.text.match(/\d{6}/)[0];
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(APP);
  await page.locator('input[type=email]').fill(email);
  await press(page, 'Continue');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await typeCode(page, await emailedCode(page, email));
  await press(page, 'Sign in');
  // A new account is offered a password once.
  const skip = page.getByRole('button', { name: 'Skip', exact: true });
  await expect(skip.or(page.getByRole('heading', { name: 'Meetups' }))).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole('heading', { name: 'Meetups' })).toBeVisible();
}

/** Creates a fixed-date meetup, votes as host and shares it. Returns the guest link. */
export async function hostMeetup(page: Page, invitees: string[]): Promise<string> {
  await tap(page, 'New meetup');
  await page.getByPlaceholder('Midnight poetry party').fill('Midnight poetry party');
  await press(page, 'Next');
  for (const name of invitees) {
    await page.getByPlaceholder('Add a name').fill(name);
    await press(page, 'Add');
  }
  await press(page, 'Create');
  await tap(page, 'Pizza');
  await tap(page, 'Ramen');
  await press(page, 'Vote');
  await press(page, 'Share');
  await expect(page.getByText('Copy link')).toBeVisible();
  const text = await page.locator('body').innerText();
  return `http://${text.match(/localhost:5173\/j\/[A-Za-z0-9_-]+/)![0]}`;
}

/** A guest in their own browser: picks a name and returns the page and their code. */
export async function joinAs(browser: Browser, link: string, name: string, at = { latitude: 1.305, longitude: 103.83 }): Promise<{ page: Page; code: string }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: at });
  const page = await ctx.newPage();
  await page.goto(link);
  await tap(page, name);
  await tap(page, `I'm ${name}`);
  await expect(page.getByText('Keep this code')).toBeVisible();
  const code = (await page.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join('');
  await press(page, 'Continue');
  return { page, code };
}

/** A 6-digit authenticator code for a base32 key (RFC 6238, 30 seconds, SHA-1). */
export function totp(base32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32.replace(/=+$/, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const o = mac[mac.length - 1]! & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Emails the demo "sent" to an address, oldest first. */
export async function mailsTo(page: Page, email: string): Promise<Array<{ subject: string; text: string }>> {
  const { outbox } = await (await page.request.get(`${APP}/api/dev/outbox`)).json();
  return outbox.filter((m: { to: string }) => m.to === email);
}

/** Plays Telegram's part: the person opens the bot link and presses Start in a private chat. */
export async function pressStartInTelegram(page: Page, botLink: string, chatId: number): Promise<void> {
  const start = new URL(botLink).searchParams.get('start');
  const res = await page.request.post(`${APP}/api/webhooks/telegram`, {
    headers: { 'x-telegram-bot-api-secret-token': 'demo-telegram-secret' },
    data: { update_id: chatId, message: { message_id: 1, text: `/start ${start}`, chat: { id: chatId, type: 'private' } } },
  });
  expect(res.status()).toBe(200);
}

/** Messages the demo "sent" to a Telegram chat, oldest first. */
export async function telegramTo(page: Page, chatId: number): Promise<Array<{ subject: string; text: string }>> {
  const { outbox } = await (await page.request.get(`${APP}/api/dev/outbox`)).json();
  return outbox.filter((m: { to: string }) => m.to === `telegram:${chatId}`);
}
