import { Hono } from 'hono';
import { neonDb } from '@zorion/db';
import { DEFAULT_EMAIL_FROM, cachedSettings, tidySettings } from '@zorion/server/settings';
import { account, auth } from './auth';
import { type App, type Deps, Fail, isProd, loadSession } from './core';
import { ads, billing, maintain, publicConfig, webhooks } from './extras';
import { guest } from './guest';
import { catalog, meetups } from './meetups';
import { telegramWebhook } from './telegram';

const outbox: Deps['outbox'] = [];
// Each Worker instance checks the shared maintenance clock at most every 5 minutes, so ordinary requests
// do not each add a database call.
const CHECK_EVERY_MS = 5 * 60_000;
let lastCheck = 0;

/** Builds the API. Tests pass their own database, clock and fetch. */
export function createApp(overrides: Partial<Deps> = {}) {
  const app = new Hono<App>();

  app.use('*', async (c, next) => {
    const base = overrides.env ?? c.env;
    const db = overrides.db ?? neonDb(base.DATABASE_URL);
    // Keys and addresses saved in the admin portal win over the Worker's own variables.
    const saved: Partial<Record<string, string>> = await cachedSettings(db, base.TOTP_KEY).catch(() => ({}));
    const env = tidySettings({ ...base, ...saved });
    if (!env.EMAIL_FROM && isProd(env)) env.EMAIL_FROM = DEFAULT_EMAIL_FROM;
    const keyFrom = saved.RESEND_API_KEY ? 'portal' : env.RESEND_API_KEY ? 'worker' : 'none';
    // Never store the built-in fetch as a method: Workers throws "Illegal invocation" when it is called
    // as deps.fetch(...). Wrapping it keeps every outside call (email, Stripe, Telegram, maps) working.
    const send = overrides.fetch ?? fetch;
    c.set('deps', { db, env, keyFrom, fetch: (...a: Parameters<typeof fetch>) => send(...a), now: overrides.now ?? (() => new Date()), outbox: overrides.outbox ?? outbox });
    await next();
    c.header('x-content-type-options', 'nosniff');
    c.header('referrer-policy', 'strict-origin-when-cross-origin');
    c.header('cache-control', 'no-store');
    // Housekeeping rides on real traffic, after the response is sent (no cron trigger). Tests have no
    // execution context, so this is skipped there and tests call maintain() directly.
    if (Date.now() - lastCheck > CHECK_EVERY_MS) {
      let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
      try { ctx = c.executionCtx; } catch { ctx = undefined; }
      if (ctx) {
        lastCheck = Date.now();
        const deps = c.get('deps');
        ctx.waitUntil(maintain(deps).catch((err) => console.error('maintenance', err instanceof Error ? err.message : err)));
      }
    }
  });

  // Cross-site request forgery: state-changing calls must come from our own page.
  // The custom header cannot be sent cross-site without a CORS preflight, which we never allow.
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !c.req.path.startsWith('/api/webhooks/')) {
      const origin = c.req.header('origin');
      if (c.req.header('x-zorion') !== '1' || (origin && origin !== c.get('deps').env.APP_ORIGIN)) throw new Fail(403, 'forbidden', 'This request was not allowed.');
    }
    await loadSession(c);
    await next();
  });

  app.route('/api/auth', auth);
  app.route('/api/account', account);
  app.route('/api/meetups', meetups);
  app.route('/api/g', guest);
  app.route('/api/billing', billing);
  app.route('/api/webhooks/telegram', telegramWebhook);
  app.route('/api/webhooks', webhooks);
  app.route('/api/ads', ads);
  app.route('/api/config', publicConfig);
  app.route('/api', catalog);

  // Development only: lets a developer read the sign-in code without an email provider.
  app.get('/api/dev/outbox', (c) => (isProd(c.get('deps').env) ? c.json({ error: 'not_found' }, 404) : c.json({ outbox: c.get('deps').outbox })));

  // For an optional uptime monitor; any request also lets the hourly housekeeping run.
  app.get('/api/health', (c) => c.json({ ok: true }));

  // The privacy and terms pages live on the landing site. The app links here so it never hard-codes that address.
  app.get('/api/legal/:page', (c) => {
    const page = c.req.param('page');
    return page === 'privacy' || page === 'terms' ? c.redirect(`${c.get('deps').env.SITE_ORIGIN}/${page}`, 302) : c.json({ error: 'not_found', message: 'Not found.' }, 404);
  });
  app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));

  app.onError((err, c) => {
    if (err instanceof Fail) return c.json({ error: err.code, message: err.message, ...err.extra }, err.status);
    console.error(err); // details stay in the Worker log, never in the response
    return c.json({ error: 'server', message: 'Something went wrong on our side. Please try again.' }, 500);
  });

  return app;
}

const app = createApp();

export default { fetch: app.fetch };
