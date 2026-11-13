import { expect, test } from '@playwright/test';
import { APP, hostMeetup, joinAs, signIn, tap, typeCode } from './helpers';

test('fixed date: from a new meetup to "it is on", with a typed start and no coordinates shown to anyone', async ({ page, browser }) => {
  await signIn(page, 'host-fixed@example.com');
  const link = await hostMeetup(page, ['Mia', 'Sam', 'Lee']);

  // Mia shares GPS. Sam types a place instead. Lee can't go.
  const mia = await joinAs(browser, link, 'Mia');
  await tap(mia.page, 'Going');
  await tap(mia.page, 'Continue');
  await tap(mia.page, 'Share my GPS location');
  await tap(mia.page, 'Pizza');
  await tap(mia.page, 'Tacos');
  await tap(mia.page, 'Cast my');
  await expect(mia.page.getByText('Votes in')).toBeVisible();

  const sam = await joinAs(browser, link, 'Sam');
  await tap(sam.page, 'Maybe');
  await tap(sam.page, 'Continue');
  await tap(sam.page, 'Type a place instead');
  await sam.page.getByLabel('Station, street or postcode').fill('Bugis MRT');
  await tap(sam.page, 'Search');
  await tap(sam.page, 'Bugis MRT Road');
  await tap(sam.page, 'Start from here');
  await tap(sam.page, 'Pizza');
  await tap(sam.page, 'Cast my');
  await expect(sam.page.getByText('Votes in')).toBeVisible();

  const lee = await joinAs(browser, link, 'Lee');
  await tap(lee.page, "Can't go");
  await tap(lee.page, 'Continue');
  await expect(lee.page.getByText('Maybe next time')).toBeVisible();

  // The host sees everyone's state, then finds the middle. Pizza has the most votes.
  await page.reload();
  await expect(page.getByText('2 going', { exact: true })).toBeVisible();
  await expect(page.getByText('1 maybe', { exact: true })).toBeVisible();
  await tap(page, 'Find the middle');
  await expect(page.getByText('Closest to everyone')).toBeVisible();
  await expect(page.getByText('Trip times are estimates from distance.')).toBeVisible();
  await expect(page.locator('button.pick')).toHaveCount(8);

  // Two places means a final vote; the host votes first.
  await tap(page, 'Star Table');
  await tap(page, 'Fair Middle');
  await tap(page, 'Next: cast your own vote');
  await tap(page, 'Star Table');
  await tap(page, 'Vote and share again');
  await expect(page.getByText('1 of 3 voted')).toBeVisible(); // Lee can't go, so three people count

  await mia.page.reload();
  await tap(mia.page, 'Fair Middle');
  await tap(mia.page, 'Vote for');
  await sam.page.reload();
  await tap(sam.page, 'Fair Middle');
  await tap(sam.page, 'Vote for'); // a maybe who votes becomes going

  await page.reload();
  await tap(page, 'Lock in Fair Middle');
  await expect(page.getByText('It is on.')).toBeVisible();
  await expect(page.getByText('3 going').first()).toBeVisible();

  await mia.page.reload();
  await expect(mia.page.getByText('Fair Middle it is.')).toBeVisible();
  await expect(mia.page.getByText('Open directions')).toBeVisible();

  // Coming back after confirmation: only the reply can change, and it still asks for the code.
  await expect(mia.page.getByText('Change my choices')).toHaveCount(0);
  await tap(mia.page, 'Change my reply');
  if (await mia.page.getByText('Enter your code').isVisible()) {
    await typeCode(mia.page, mia.code);
    await tap(mia.page, 'Continue to my reply');
  }
  await expect(mia.page.getByRole('heading', { name: 'Change your reply' })).toBeVisible();
  await expect(mia.page.getByText('The date, time and place are set; only your reply can change.')).toBeVisible();
  await expect(mia.page.getByText(/Starting point|Place pick|Food picks|Dates you can make/)).toHaveCount(0);
  await tap(mia.page, 'Maybe');
  await tap(mia.page, 'Save my reply');
  await expect(mia.page.getByText('Fair Middle it is.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Maybe').first()).toBeVisible();

  // Privacy: what a guest's browser receives never holds another person's position.
  const seen = await (await mia.page.request.get(`${APP}/api/g/${link.split('/j/')[1]}`)).json();
  const others = JSON.stringify(seen.meetup.people);
  expect(others).not.toMatch(/"lat"|"lng"/);
});

test('guest code: a new browser needs only the code, and three wrong tries pause it', async ({ page, browser }) => {
  await signIn(page, 'host-code@example.com');
  const link = await hostMeetup(page, ['Mia']);
  const mia = await joinAs(browser, link, 'Mia');
  expect(mia.code).toMatch(/^[2-9A-HJ-NP-Z]{4}$/);

  const other = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await other.goto(link);
  await tap(other, 'Joined before');
  await typeCode(other, mia.code);
  await tap(other, 'Continue');
  await expect(other.getByText('Hi Mia')).toBeVisible();

  const stranger = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await stranger.goto(link);
  await tap(stranger, 'Joined before');
  for (const wrong of ['ZZZ9', 'ZZZ8', 'ZZZ7']) {
    for (let i = 1; i <= 4; i++) await stranger.locator(`input[aria-label="Character ${i}"]`).fill('');
    await typeCode(stranger, wrong);
    await tap(stranger, 'Continue');
    await expect(stranger.getByText(/did not match|Three wrong tries\. This link is paused/)).toBeVisible();
  }
  await expect(stranger.getByText('Three wrong tries. This link is paused on your device for 10 minutes.')).toBeVisible();
});

test('date vote: guests tick dates, the host sets one, and whoever picked it starts as going', async ({ page, browser }) => {
  await signIn(page, 'host-dates@example.com');
  await tap(page, 'New meetup');
  await page.getByPlaceholder('Midnight poetry party').fill('Midnight poetry party');
  await tap(page, 'Or let the crew vote on the date');
  for (const d of ['2027-01-15T19:00', '2027-01-16T19:00']) {
    await page.locator('input[type=datetime-local]').fill(d);
    await tap(page, 'Add this option');
  }
  await tap(page, 'Use these 2 dates');
  await tap(page, 'Next: add your people');
  for (const name of ['Mia', 'Sam']) {
    await page.getByPlaceholder('Add a name').fill(name);
    await tap(page, 'Add to the list');
  }
  await tap(page, 'Next: cast your own vote');
  await tap(page, 'Pizza');
  await tap(page, 'Vote, then share the link');
  await tap(page, 'Share with your crew');
  await expect(page.getByText('Copy link')).toBeVisible();
  const link = `http://${(await page.locator('body').innerText()).match(/localhost:5173\/j\/[A-Za-z0-9_-]+/)![0]}`;

  const mia = await joinAs(browser, link, 'Mia');
  await expect(mia.page.getByText('When works for you?')).toBeVisible();
  await tap(mia.page, 'Sat 16 Jan');
  await tap(mia.page, 'Next: share where you are');
  await tap(mia.page, 'Share my GPS location');
  await tap(mia.page, 'Pizza');
  await tap(mia.page, 'Cast my');

  await page.reload();
  await tap(page, 'Set the date');
  await expect(page.getByText('Most votes', { exact: true })).toBeVisible();
  await tap(page, /^Set Sat 16 Jan/);
  await expect(page.getByText('Find the middle')).toBeVisible();

  await mia.page.reload();
  await expect(mia.page.getByText('You picked this date, so you are down as going.')).toBeVisible();

  // Sam arrives after the date vote and goes straight to the fixed-date steps.
  const sam = await joinAs(browser, link, 'Sam');
  await expect(sam.page.getByText('You joined after the date vote.')).toBeVisible();
});

test('two-step: turning it on shows a QR code and recovery codes, and the next sign-in asks for a second proof', async ({ page }) => {
  await signIn(page, 'host-2fa@example.com');
  await page.goto(`${APP}/account`);
  await tap(page, 'Two-step verification');
  await tap(page, 'Set up an authenticator');
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  const key = (await page.locator('body').innerText()).match(/[A-Z2-7]{32}/)![0];
  const { totp } = await import('./helpers');
  await typeCode(page, totp(key));
  await tap(page, 'Turn on two-step verification');
  await expect(page.getByText('Recovery codes')).toBeVisible();
  await tap(page, 'I have saved them');

  await page.goto(`${APP}/account`);
  await tap(page, 'Sign out');
  await page.locator('input[type=email]').fill('host-2fa@example.com');
  await tap(page, 'Send me a 6-digit code');
  const { emailedCode } = await import('./helpers');
  await expect(page.getByText('Verify and sign in')).toBeVisible();
  await typeCode(page, await emailedCode(page, 'host-2fa@example.com'));
  await tap(page, 'Verify and sign in');
  await expect(page.getByText('Enter your authenticator code')).toBeVisible();
  await typeCode(page, totp(key, Date.now() + 30_000)); // the next code: one already used cannot be used again
  await tap(page, 'Verify');
  await expect(page.getByText('Your meetups')).toBeVisible();
});

test('the app links to the privacy notice and terms on the landing site', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('a[href="/api/legal/privacy"]')).toBeVisible();
  const res = await page.request.get(`${APP}/api/legal/terms`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toBe('http://localhost:5174/terms');
});

test('emails: a guest opts in and confirms, the host hears the votes are in, the guest hears it is on and can stop', async ({ page, browser }) => {
  const { mailsTo } = await import('./helpers');
  await signIn(page, 'host-mail@example.com');
  const link = await hostMeetup(page, ['Mia']);

  const mia = await joinAs(browser, link, 'Mia');
  await tap(mia.page, 'Going');
  await tap(mia.page, 'Continue');
  await tap(mia.page, 'Share my GPS location');
  await tap(mia.page, 'Pizza');
  await tap(mia.page, 'Cast my');
  await expect(mia.page.getByText('Votes in')).toBeVisible();

  // Mia asks for updates. Nothing but a confirmation goes out until she confirms.
  await tap(mia.page, 'Get updates when the place is set');
  await tap(mia.page, 'By email');
  await mia.page.getByLabel('Your email').fill('mia-mail@example.com');
  await tap(mia.page, 'Email me updates');
  await expect(mia.page.getByText('Check m•••@example.com and open the link to confirm.')).toBeVisible();
  const confirm = (await mailsTo(page, 'mia-mail@example.com')).at(-1)!;
  expect(confirm.subject).toBe('Confirm email updates for Midnight poetry party');

  // She opens the link on another device. The secret leaves the address bar straight away.
  const other = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await other.goto(confirm.text.match(/http\S+\?confirm=\S+/)![0]);
  await expect(other.getByRole('status')).toHaveText('Email updates are on for Mia.');
  expect(other.url()).not.toContain('confirm=');
  await mia.page.reload();
  await expect(mia.page.getByText('Email updates go to')).toBeVisible();

  // The host was told the votes are in, and never sees Mia's address.
  expect((await mailsTo(page, 'host-mail@example.com')).map((m) => m.subject)).toContain('The food votes are in for Midnight poetry party');
  await page.reload();
  await expect(page.getByText('mia-mail@example.com')).toHaveCount(0);
  await tap(page, 'Find the middle');
  await tap(page, 'Star Table');
  await tap(page, 'Lock in Star Table and share');
  await expect(page.getByText('It is on.')).toBeVisible();

  const news = (await mailsTo(page, 'mia-mail@example.com')).at(-1)!;
  expect(news.subject).toBe('It is on: Midnight poetry party');
  expect(news.text).toContain('Star Table');
  await other.goto(news.text.match(/http\S+\?stop=\S+/)![0]);
  await expect(other.getByRole('status')).toHaveText('Email updates are off. Your address is forgotten.');
  await mia.page.reload();
  await expect(mia.page.getByText('Get updates if the plan changes')).toBeVisible();

  // A host can switch their own emails off.
  await page.goto(`${APP}/account`);
  const toggle = page.getByRole('switch', { name: /Email me about my meetups/ });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('telegram: a guest and the host connect, and get the same update as email, laid out like it', async ({ page, browser }) => {
  const { mailsTo, pressStartInTelegram, telegramTo } = await import('./helpers');
  const hostEmail = `host-tg-${Date.now()}@example.com`; // fresh each run, so a retry starts clean
  const guestEmail = `mia-tg-${Date.now()}@example.com`;
  await signIn(page, hostEmail);

  // The host connects Telegram under Account.
  await page.goto(`${APP}/account`);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  const hostLink = await page.getByRole('link', { name: 'Open Telegram' }).getAttribute('href');
  expect(hostLink).toMatch(/^https:\/\/t\.me\/ZorionDemoBot\?start=[A-Za-z0-9_-]{32}$/);
  await pressStartInTelegram(page, hostLink!, 7001);
  await expect(page.getByText('Connected. The same news comes there too.')).toBeVisible({ timeout: 10_000 });
  expect((await telegramTo(page, 7001)).at(-1)!.text).toContain('Connected. Zorion will message you here about the meetups you host');

  await page.goto(APP);
  const link = await hostMeetup(page, ['Mia']);
  const mia = await joinAs(browser, link, 'Mia');
  await tap(mia.page, 'Going');
  await tap(mia.page, 'Continue');
  await tap(mia.page, 'Share my GPS location');
  await tap(mia.page, 'Pizza');
  await tap(mia.page, 'Cast my');

  // Mia picks Telegram, then email as well.
  await tap(mia.page, 'Get updates when the place is set');
  await tap(mia.page, 'On Telegram');
  const miaLink = await mia.page.getByRole('link', { name: 'Open Telegram' }).getAttribute('href');
  await pressStartInTelegram(mia.page, miaLink!, 7002);
  await mia.page.reload();
  await expect(mia.page.getByText('Updates come on')).toBeVisible(); // Telegram only, so far
  await tap(mia.page, 'Also by email');
  await mia.page.getByLabel('Your email').fill(guestEmail);
  await tap(mia.page, 'Email me updates');
  await expect(mia.page.getByText(/open the link to confirm/)).toBeVisible(); // the request has finished, so the email is out
  const confirm = (await mailsTo(page, guestEmail)).at(-1)!;
  await mia.page.goto(confirm.text.match(/http\S+\?confirm=\S+/)![0]);
  await expect(mia.page.getByText('Email updates go to')).toBeVisible();

  // The host heard the votes are in on both channels, worded the same.
  const hostMail = (await mailsTo(page, hostEmail)).find((m) => m.subject.startsWith('The food votes are in'))!;
  const hostTg = (await telegramTo(page, 7001)).find((m) => m.subject.startsWith('The food votes are in'))!;
  expect(hostTg.subject).toBe(hostMail.subject);
  expect(hostTg.text.split('\n').slice(0, -1)).toEqual(hostMail.text.split('\n').slice(0, -1));
  expect(hostTg.text.split('\n').at(-1)).toMatch(/, or send \/stop\.$/);

  // It is on: Mia gets it on both.
  await page.reload();
  await tap(page, 'Find the middle');
  await tap(page, 'Star Table');
  await tap(page, 'Lock in Star Table and share');
  await expect(page.getByText('It is on.')).toBeVisible();
  const mail = (await mailsTo(page, guestEmail)).at(-1)!;
  const tg = (await telegramTo(page, 7002)).at(-1)!;
  expect(tg.subject).toBe('It is on: Midnight poetry party');
  expect(tg.subject).toBe(mail.subject);
  expect(tg.text.split('\n').slice(0, -1)).toEqual(mail.text.split('\n').slice(0, -1));
  expect(tg.text.split('\n').at(-1)).toBe('You asked for updates about this meetup. Send /stop to stop them.');

  // Stopping Telegram leaves email on.
  await mia.page.locator('.row').filter({ hasText: 'Updates also come on' }).getByRole('button', { name: 'Stop' }).click();
  await mia.page.reload();
  const updates = mia.page.locator('.card').filter({ hasText: 'Email updates go to' });
  await expect(updates).toBeVisible();
  await expect(mia.page.getByText(/Updates (also )?come on/)).toHaveCount(0);
});
