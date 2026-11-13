import { createHmac } from 'node:crypto';
import { type Browser, type Page, expect } from '@playwright/test';

export const APP = 'http://localhost:5173';
export const SITE = 'http://localhost:5174';

/** Clicks the first button or link that contains the text. */
export async function tap(page: Page, text: string | RegExp): Promise<void> {
  await page.locator('button, a, [role=button]').filter({ hasText: text }).first().click();
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
  await tap(page, 'Send me a 6-digit code');
  await expect(page.getByText('Verify and sign in')).toBeVisible();
  await typeCode(page, await emailedCode(page, email));
  await tap(page, 'Verify and sign in');
  await expect(page.getByText('Your meetups')).toBeVisible();
}

/** Creates a fixed-date meetup, votes as host and shares it. Returns the guest link. */
export async function hostMeetup(page: Page, invitees: string[]): Promise<string> {
  await tap(page, 'New meetup');
  await page.getByPlaceholder('Midnight poetry party').fill('Midnight poetry party');
  await tap(page, 'Next: add your people');
  for (const name of invitees) {
    await page.getByPlaceholder('Add a name').fill(name);
    await tap(page, 'Add to the list');
  }
  await tap(page, 'Next: cast your own vote');
  await tap(page, 'Pizza');
  await tap(page, 'Ramen');
  await tap(page, 'Vote, then share the link');
  await tap(page, 'Share with your crew');
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
  await tap(page, `I am ${name}`);
  await expect(page.getByText('Keep this code')).toBeVisible();
  const code = (await page.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join('');
  await tap(page, 'Got it, continue');
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
