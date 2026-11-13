import { Hono } from 'hono';
import { neonDb } from '@zorion/db';
import { account, auth } from './auth';
import { type App, type Deps, type Env, Fail, isProd, loadSession } from './core';
import { ads, billing, cleanUp, webhooks } from './extras';
import { guest } from './guest';
import { catalog, meetups } from './meetups';

const outbox: Deps['outbox'] = [];

/** Builds the API. Tests pass their own database, clock and fetch. */
export function createApp(overrides: Partial<Deps> = {}) {
  const app = new Hono<App>();

  app.use('*', async (c, next) => {
    const env = overrides.env ?? c.env;
    c.set('deps', { db: overrides.db ?? neonDb(env.DATABASE_URL), env, fetch: overrides.fetch ?? fetch, now: overrides.now ?? (() => new Date()), outbox: overrides.outbox ?? outbox });
    await next();
    c.header('x-content-type-options', 'nosniff');
    c.header('referrer-policy', 'strict-origin-when-cross-origin');
    c.header('cache-control', 'no-store');
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
  app.route('/api/webhooks', webhooks);
  app.route('/api/ads', ads);
  app.route('/api', catalog);

  // Development only: lets a developer read the sign-in code without an email provider.
  app.get('/api/dev/outbox', (c) => (isProd(c.get('deps').env) ? c.json({ error: 'not_found' }, 404) : c.json({ outbox: c.get('deps').outbox })));

  app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));

  app.onError((err, c) => {
    if (err instanceof Fail) return c.json({ error: err.code, message: err.message, ...err.extra }, err.status);
    console.error(err); // details stay in the Worker log, never in the response
    return c.json({ error: 'server', message: 'Something went wrong on our side. Please try again.' }, 500);
  });

  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_event: unknown, env: Env) {
    await cleanUp(neonDb(env.DATABASE_URL));
  },
};
