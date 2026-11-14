// Local demo: both sites on one machine, with an in-memory database and no outside services.
// Nothing here is used in production. Places are made up, and emails are printed to this terminal.
//   npm run build && npm run demo
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { testDb } from '@zorion/db/testing';
import { hashPassword, newTotpSecret, seal } from '@zorion/server/crypto';
import { createApp } from '../apps/app/worker/index';
import { createAdmin } from '../apps/site/worker/index';

const APP_PORT = 5173;
const SITE_PORT = 5174;
const env = {
  DATABASE_URL: '',
  APP_ORIGIN: `http://localhost:${APP_PORT}`,
  SITE_ORIGIN: `http://localhost:${SITE_PORT}`,
  PEPPER: 'demo-pepper-not-for-production',
  TOTP_KEY: btoa('0123456789abcdef0123456789abcdef'),
  ENVIRONMENT: 'development',
  // A pretend bot: the Telegram choice shows, and messages land in the outbox instead of Telegram.
  // To play Telegram's part, POST to /api/webhooks/telegram with the header below (see e2e/helpers.ts).
  TELEGRAM_BOT_USERNAME: 'ZorionDemoBot',
  TELEGRAM_WEBHOOK_SECRET: 'demo-telegram-secret',
};
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

// Made-up places scattered around wherever the search is centred.
const NAMES = ['Lucky Trotter', 'Midnight Oven', 'Pink Hat Kitchen', 'Fair Middle', 'Star Table', 'The Snout', 'Poetry Corner', 'Good Fortune'];
const fakePlaces = (async (_url: string, init?: RequestInit) => {
  if (String(_url).includes('nominatim')) {
    // Made-up matches for a typed starting place.
    const q = new URL(String(_url)).searchParams.get('q') ?? 'Somewhere';
    return Response.json([{ lat: '1.3009', lon: '103.8559', display_name: `${q}, Demo District, Singapore` }, { lat: '1.2966', lon: '103.8520', display_name: `${q} Road, Demo District, Singapore` }]);
  }
  const m = decodeURIComponent(String(init?.body ?? '')).match(/around:\d+,(-?[\d.]+),(-?[\d.]+)/);
  const lat = Number(m?.[1] ?? 1.3);
  const lng = Number(m?.[2] ?? 103.84);
  return Response.json({ elements: NAMES.map((name, i) => ({ type: 'node', id: i + 1, lat: lat + Math.sin(i * 1.7) * 0.002, lon: lng + Math.cos(i * 1.7) * 0.002, tags: { name, 'addr:street': 'Demo Street', 'addr:housenumber': String(10 + i) } })) });
}) as unknown as typeof fetch;

const db = await testDb();
const outbox = new Proxy([] as Array<{ to: string; subject: string; text: string }>, {
  set(target, key, value) {
    if (typeof value === 'object' && value?.text) console.log(`\n[email to ${value.to}] ${value.subject}\n${value.text}\n`);
    return Reflect.set(target, key, value);
  },
});
const app = createApp({ db, env, fetch: fakePlaces, outbox });
const admin = createAdmin({ db, env: { ...env, ADMIN_SETUP_TOKEN: process.env.DEMO_SETUP === '1' ? 'demo-setup-token-1234' : undefined } });

// The browser tests pass a fixed key so they can work out the admin's authenticator code.
const adminSecret = process.env.DEMO_ADMIN_KEY || newTotpSecret();
// DEMO_SETUP=1 starts with no admin, to try the first-admin setup (token: demo-setup-token-1234).
const setupDemo = process.env.DEMO_SETUP === '1';
if (!setupDemo) await db.query('insert into admins (email, password_hash, totp_secret, totp_enabled, role) values ($1, $2, $3, true, $4)', ['admin@example.com', await hashPassword('demo-admin-password', env.PEPPER), await seal(adminSecret, env.TOTP_KEY), 'super']);

function serve(port: number, root: string, isApi: (path: string) => boolean, api: { fetch(req: Request): Response | Promise<Response> }) {
  const base = resolve(root);
  createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (isApi(url.pathname)) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const out = await api.fetch(new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks) }));
        res.statusCode = out.status;
        out.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); });
        const cookies = out.headers.getSetCookie();
        if (cookies.length) res.setHeader('set-cookie', cookies);
        res.end(Buffer.from(await out.arrayBuffer()));
        return;
      }
      const wanted = normalize(join(base, url.pathname));
      const file = wanted.startsWith(base) && extname(wanted) ? wanted : join(base, 'index.html');
      const data = await readFile(file).catch(() => readFile(join(base, 'index.html')));
      res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.end(data);
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end('Demo server error');
    }
  }).listen(port, '127.0.0.1');
}

serve(APP_PORT, 'apps/app/dist/client', (p) => p.startsWith('/api/'), app);
serve(SITE_PORT, 'apps/site/dist/client', (p) => p.startsWith('/api/') || p.startsWith('/admin/api/') || p === '/ad-frame' || p === '/ads.txt', admin);

console.log(`Zorion demo is running. Data lives in memory and is gone when you stop it.
  App      ${env.APP_ORIGIN}
  Landing  ${env.SITE_ORIGIN}
  Admin    ${env.SITE_ORIGIN}/admin   ${setupDemo ? 'no admin yet: set one up with the token demo-setup-token-1234' : `admin@example.com / demo-admin-password\n           authenticator key: ${adminSecret}`}
Sign-in codes for the app are printed here instead of being emailed.`);
