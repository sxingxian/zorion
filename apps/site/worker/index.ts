import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { z } from 'zod';
import { OWN_ICONS, SG_TILE_CHOICES, type TileSourceKey, WORLD_TILE_CHOICES, cleanName } from '@zorion/core';
import { type Db, type Row, neonDb, one } from '@zorion/db';
import { hashPassword, hmac, newTotpSecret, otpauthUri, randomToken, safeEqual, seal, sha256, unseal, verifyPassword, verifyTotp } from '@zorion/server/crypto';
import { settingsStatus } from '@zorion/server/settings';
import { usageReport } from '@zorion/server/usage';
import { type App, type C, type Deps, type Env, Fail, IDLE_MINUTES, audit, body, cookie, lockKey, locked, mask, need, secure, session, strike, uuid } from './core';
import { config, plans } from './config';

// ---------- sensitive actions: a second admin has to approve ----------
const ACTIONS = {
  'user.suspend': z.object({ userId: uuid, suspend: z.boolean() }),
  'user.delete': z.object({ userId: uuid }),
  // Pro given by an admin. endsOn is the last day of Pro (Singapore time); null means no end date. grant: false removes it.
  'user.pro': z.object({
    userId: uuid,
    grant: z.boolean(),
    endsOn: z.string().date().nullable().default(null),
    note: z.string().trim().max(120).default(''),
  }).refine((p) => !p.grant || p.endsOn === null || (p.endsOn > sgToday() && p.endsOn <= sgToday(5)), { message: 'Pick an end date from tomorrow up to five years ahead.' }),
  'ads.placement': z.object({ key: z.string().max(40), enabled: z.boolean() }),
  'ads.sponsor': z.object({ name: z.string().trim().min(1).max(60), categoryKey: z.string().max(24).nullable(), url: z.string().url().startsWith('https://').max(300).nullable(), startsOn: z.string().date(), endsOn: z.string().date() }),
  'ads.adsense': z.object({ publisherId: z.string().regex(/^(ca-pub-\d{10,20})?$/), slot: z.string().regex(/^(\d{6,20})?$/).default(''), consent: z.boolean() }),
} as const;
type Action = keyof typeof ACTIONS;

/** Today's date in Singapore, optionally some years ahead, as YYYY-MM-DD. */
function sgToday(yearsAhead = 0): string {
  const d = new Date(Date.now() + 8 * 3_600_000);
  d.setUTCFullYear(d.getUTCFullYear() + yearsAhead);
  return d.toISOString().slice(0, 10);
}
/** Who has Pro, worked out the same way as in the app: paid, or given and not yet ended. */
const PLAN_SQL = `(case when u.plan = 'pro' or u.pro_grant_until > now() then 'pro' else 'free' end)`;

async function execute(db: Db, action: Action, p: any): Promise<void> {
  if (action === 'user.suspend') {
    await db.batch([
      ['update users set status = $2 where id = $1', [p.userId, p.suspend ? 'suspended' : 'active']],
      ...(p.suspend ? [['delete from sessions where user_id = $1', [p.userId]] as [string, unknown[]]] : []),
    ]);
  } else if (action === 'user.delete') await db.query('delete from users where id = $1', [p.userId]);
  else if (action === 'user.pro') {
    // Ends at the close of the chosen day in Singapore. Paid Pro (users.plan) is never touched.
    if (p.grant) await db.query(`update users set pro_grant_until = case when $2::date is null then 'infinity'::timestamptz else (($2::date + 1)::timestamp at time zone 'Asia/Singapore') end, pro_grant_note = nullif($3, '') where id = $1`, [p.userId, p.endsOn, p.note]);
    else await db.query('update users set pro_grant_until = least(pro_grant_until, now()) where id = $1', [p.userId]);
  }
  else if (action === 'ads.placement') await db.query('update ad_placements set enabled = $2 where key = $1', [p.key, p.enabled]);
  else if (action === 'ads.sponsor') await db.query('insert into sponsors (name, category_key, url, starts_on, ends_on) values ($1, $2, $3, $4, $5)', [p.name, p.categoryKey, p.url, p.startsOn, p.endsOn]);
  else if (action === 'ads.adsense') await db.query("insert into settings (key, value) values ('adsense', $1) on conflict (key) do update set value = excluded.value, updated_at = now()", [JSON.stringify(p)]);
}

export function createAdmin(overrides: Partial<Deps> = {}) {
  const app = new Hono<App>();

  app.use('*', async (c, next) => {
    const env = overrides.env ?? c.env;
    c.set('deps', { db: overrides.db ?? neonDb(env.DATABASE_URL), env, now: overrides.now ?? (() => new Date()), fetch: overrides.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)) });
    c.set('admin', null);
    c.set('pending', null);
    await next();
    c.header('x-content-type-options', 'nosniff');
    if (!c.res.headers.has('cache-control')) c.header('cache-control', 'no-store');
    c.header('x-robots-tag', 'noindex, nofollow');
  });

  // Public, read-only: what the landing page shows about plans and prices.
  app.get('/api/public/config', async (c) => {
    const { env } = c.get('deps');
    const contactEmail = env.CONTACT_EMAIL && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(env.CONTACT_EMAIL) ? env.CONTACT_EMAIL : null;
    c.header('cache-control', 'public, max-age=60');
    return c.json({ appUrl: env.APP_ORIGIN, contactEmail, plans: await plans(c) });
  });

  // A Google ad for the app, served from this site inside a frame. The app itself never loads Google's
  // scripts: the frame is another origin, so an ad cannot read the app's pages or cookies. The frame tells
  // the app whether an ad showed; if not, the app shows a sponsored slot instead.
  app.get('/ad-frame', async (c) => {
    const { db, env } = c.get('deps');
    const adsense = ((await one(db, "select value from settings where key = 'adsense'"))?.value ?? {}) as { publisherId?: string; slot?: string };
    const pub = /^ca-pub-\d{10,20}$/.test(adsense.publisherId ?? '') ? adsense.publisherId! : null;
    const slot = /^\d{6,20}$/.test(adsense.slot ?? '') ? adsense.slot! : null;
    const nonce = randomToken(16).replace(/[^A-Za-z0-9]/g, '');
    const app = JSON.stringify(env.APP_ORIGIN);
    const ad = pub && slot && c.req.query('consent') === 'yes'
      ? `<ins class="adsbygoogle" style="display:block;width:100%;height:100px" data-ad-client="${pub}" data-ad-slot="${slot}" data-full-width-responsive="true"></ins>
<script nonce="${nonce}">
var s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${pub}';
s.onerror = function () { tell('none'); }; document.head.appendChild(s);
(window.adsbygoogle = window.adsbygoogle || []).push({});
var ins = document.querySelector('ins');
new MutationObserver(function () { var s = ins.getAttribute('data-ad-status'); if (s) tell(s === 'filled' ? 'filled' : 'none'); }).observe(ins, { attributes: true });
setTimeout(function () { if (ins.getAttribute('data-ad-status') !== 'filled') tell('none'); }, 4000);
</script>`
      : `<script nonce="${nonce}">tell('none');</script>`;
    c.header('content-security-policy', `default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic' https:; style-src 'unsafe-inline'; img-src https: data:; frame-src https:; connect-src https:; frame-ancestors ${env.APP_ORIGIN}; base-uri 'none'; form-action 'none'`);
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'strict-origin-when-cross-origin');
    return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><style>html,body{margin:0;background:transparent}</style>
<script nonce="${nonce}">var told = false; function tell(s) { if (told) return; told = true; parent.postMessage({ zorionAd: s }, ${app}); }</script></head><body>${ad}</body></html>`);
  });

  // AdSense's ads.txt, made from the publisher ID saved in the admin portal, so no file has to be committed.
  app.get('/ads.txt', async (c) => {
    const adsense = (await one(c.get('deps').db, "select value from settings where key = 'adsense'"))?.value ?? {};
    const pub = typeof adsense.publisherId === 'string' ? adsense.publisherId.replace(/^ca-/, '') : '';
    if (!/^pub-\d{10,20}$/.test(pub)) return c.text('', 404);
    c.header('cache-control', 'public, max-age=300');
    return c.text(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
  });

  app.use('/admin/api/*', async (c, next) => {
    const { db, env } = c.get('deps');
    if (c.req.method !== 'GET') {
      const origin = c.req.header('origin');
      if (c.req.header('x-zorion') !== '1' || (origin && origin !== env.SITE_ORIGIN)) throw new Fail(403, 'forbidden', 'This request was not allowed.');
    }
    const token = getCookie(c, cookie(env));
    if (token) {
      const row = await one(db, `select s.id as sid, s.kind, a.id, a.email, a.role from admin_sessions s join admins a on a.id = s.admin_id where s.token_hash = $1 and s.expires_at > now() and a.active`, [await sha256(token)]);
      if (row?.kind === 'pending_2fa') c.set('pending', row.id);
      else if (row) {
        c.set('admin', { id: row.id, email: row.email, role: row.role });
        await db.query('update admin_sessions set expires_at = now() + make_interval(mins => $2::int) where id = $1', [row.sid, IDLE_MINUTES]); // idle timeout slides
      }
    }
    await next();
  });

  const api = new Hono<App>();

  // ---------- first admin, from the browser ----------
  // Open only while there are no admins at all, and only with ADMIN_SETUP_TOKEN, a secret the owner
  // sets on this Worker. Once the first admin exists, these routes refuse everything.
  const SETUP_KEY = 'admin-setup';
  async function setupOpen(c: C): Promise<boolean> {
    const { db, env } = c.get('deps');
    return !!env.ADMIN_SETUP_TOKEN && env.ADMIN_SETUP_TOKEN.length >= 16 && !(await one(db, 'select 1 from admins limit 1'));
  }
  async function checkSetupToken(c: C, token: string): Promise<void> {
    const { db, env } = c.get('deps');
    if (!(await setupOpen(c))) throw new Fail(404, 'closed', 'Setup is closed.');
    if (await locked(db, SETUP_KEY)) throw new Fail(429, 'locked', 'Too many tries. Try again in 30 minutes.');
    if (!safeEqual(token, env.ADMIN_SETUP_TOKEN!)) {
      await strike(db, SETUP_KEY);
      await db.query('insert into audit_log (action) values ($1)', ['setup.failed']);
      throw new Fail(401, 'wrong', 'That setup token did not match.');
    }
  }
  api.get('/setup', async (c) => c.json({ open: await setupOpen(c) }));
  /** A fresh authenticator key. Nothing is stored until the owner proves it works in the next call. */
  api.post('/setup/key', async (c) => {
    const { token } = await body(c, z.object({ token: z.string().max(256) }));
    await checkSetupToken(c, token);
    const secret = newTotpSecret();
    return c.json({ secret, uri: otpauthUri(secret, 'first admin', 'Zorion Admin') });
  });
  api.post('/setup', async (c) => {
    const input = await body(c, z.object({
      token: z.string().max(256),
      email: z.string().trim().toLowerCase().email().max(254),
      password: z.string().min(12, 'Use at least 12 characters.').max(128),
      secret: z.string().regex(/^[A-Z2-7]{32}$/),
      code: z.string().regex(/^\d{6}$/),
    }));
    await checkSetupToken(c, input.token);
    const { db, env, now } = c.get('deps');
    const step = await verifyTotp(input.secret, input.code, now(), 0);
    if (step === null) throw new Fail(401, 'wrong_code', 'That code did not match. Check the time on your phone.');
    // Inserted only if there is still no admin, so two tabs racing cannot make two.
    const row = await one(db, `insert into admins (email, password_hash, totp_secret, totp_enabled, totp_last_step, role)
      select $1, $2, $3, true, $4, 'super' where not exists (select 1 from admins) returning id`,
      [input.email, await hashPassword(input.password, env.PEPPER), await seal(input.secret, env.TOTP_KEY), step]);
    if (!row) throw new Fail(404, 'closed', 'Setup is closed.');
    await db.query('delete from throttles where key = $1', [SETUP_KEY]);
    await session(c, row.id, 'full');
    c.set('admin', { id: row.id, email: input.email, role: 'super' });
    await audit(c, 'setup.first_admin', mask(input.email));
    return c.json({ next: 'done' });
  });

  // Admin sign-in is always password, then authenticator. No email codes, no recovery by email.
  api.post('/sign-in', async (c) => {
    const { email, password } = await body(c, z.object({ email: z.string().trim().toLowerCase().max(254), password: z.string().min(1).max(128) }));
    const { db, env } = c.get('deps');
    const key = await lockKey(email);
    if (await locked(db, key)) throw new Fail(429, 'locked', 'Too many tries. Sign-in is paused for 30 minutes.');
    const admin = await one(db, 'select * from admins where email = $1 and active', [email]);
    if (!(await verifyPassword(password, admin?.password_hash ?? null, env.PEPPER)) || !admin || !admin.totp_enabled) {
      await strike(db, key);
      await db.query('insert into audit_log (action, target) values ($1, $2)', ['sign_in.failed', mask(email)]);
      throw new Fail(401, 'wrong', 'That did not match.');
    }
    await session(c, admin.id, 'pending_2fa');
    return c.json({ next: 'two_step' });
  });

  api.post('/two-step', async (c) => {
    const { code } = await body(c, z.object({ code: z.string().regex(/^\d{6}$/) }));
    const { db, env, now } = c.get('deps');
    const id = c.get('pending');
    if (!id) throw new Fail(401, 'sign_in', 'Start signing in again.');
    const admin = (await one(db, 'select * from admins where id = $1', [id]))!;
    const key = await lockKey(admin.email);
    if (await locked(db, key)) throw new Fail(429, 'locked', 'Too many tries. Sign-in is paused for 30 minutes.');
    const step = await verifyTotp(await unseal(admin.totp_secret, env.TOTP_KEY), code, now(), Number(admin.totp_last_step));
    if (step === null) {
      await strike(db, key);
      throw new Fail(401, 'wrong', 'That code did not match.');
    }
    await db.query('update admins set totp_last_step = $2 where id = $1', [id, step]);
    await db.query('delete from throttles where key = $1', [key]);
    await session(c, id, 'full');
    c.set('admin', { id, email: admin.email, role: admin.role });
    await audit(c, 'sign_in', null);
    return c.json({ next: 'done' });
  });

  api.post('/sign-out', async (c) => {
    const { db, env } = c.get('deps');
    const token = getCookie(c, cookie(env));
    if (token) await db.query('delete from admin_sessions where token_hash = $1', [await sha256(token)]);
    deleteCookie(c, cookie(env), { path: '/', secure: secure(env) });
    return c.json({ ok: true });
  });

  api.get('/me', (c) => c.json({ admin: c.get('admin'), idleMinutes: IDLE_MINUTES }));

  api.get('/overview', async (c) => {
    need(c);
    const { db, env } = c.get('deps');
    const days = c.req.query('days') === '30' ? 30 : 7;
    const [users, stages, pending, period, perDay, statuses, recent] = await Promise.all([
      db.query(`select count(*)::int as hosts, count(*) filter (where ${PLAN_SQL} = 'pro')::int as pro,
                  count(*) filter (where u.plan <> 'pro' and u.pro_grant_until > now())::int as pro_given, count(*) filter (where status = 'suspended')::int as suspended,
                  count(*) filter (where created_at > now() - make_interval(days => $1))::int as new_hosts from users u`, [days]),
      db.query('select status, count(*)::int as n from meetups group by status'),
      db.query("select count(*)::int as n from approvals where status = 'pending'"),
      db.query(`select
          (select count(*)::int from meetups where created_at > now() - make_interval(days => $1)) as made,
          (select count(*)::int from meetups where created_at > now() - make_interval(days => $1 * 2) and created_at <= now() - make_interval(days => $1)) as made_before,
          (select count(*)::int from meetups where created_at > now() - make_interval(days => $1) and status in ('confirmed', 'ended') and chosen_place is not null) as confirmed,
          (select count(*)::int from participants where not is_host and created_at > now() - make_interval(days => $1)) as guests`, [days]),
      db.query(`select to_char(d, 'YYYY-MM-DD') as day, (select count(*)::int from meetups m where m.created_at >= d and m.created_at < d + interval '1 day') as n
                from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d order by d`),
      db.query("select key, value from settings where key in ('email_status', 'maps_status')"),
      db.query('select l.id, l.action, l.target, l.detail, l.created_at, a.email from audit_log l left join admins a on a.id = l.admin_id order by l.created_at desc limit 5'),
    ]);
    const st = await settingsStatus(db, env as unknown as Record<string, unknown>);
    const saved = Object.fromEntries(statuses.map((r) => [String(r.key), r.value]));
    return c.json({
      days,
      users: users[0], period: period[0], perDay,
      meetups: Object.fromEntries(stages.map((r) => [r.status, r.n])),
      pendingApprovals: pending[0]!.n,
      services: {
        stripe: st.STRIPE_SECRET_KEY.set, stripeWebhook: st.STRIPE_WEBHOOK_SECRET.set,
        email: st.RESEND_API_KEY.set, emailLast: saved.email_status ?? null,
        telegram: st.TELEGRAM_BOT_TOKEN.set,
        google: st.GOOGLE_PLACES_KEY.set, geoapify: st.GEOAPIFY_KEY.set, onemap: st.ONEMAP_EMAIL.set && st.ONEMAP_PASSWORD.set, ors: st.ORS_API_KEY.set,
        maps: saved.maps_status ?? {},
      },
      usage: await usageReport(db, c.get('deps').now()),
      recent,
    });
  });

  // ----- activity: the audit log, paged -----
  const KINDS: Record<string, string[]> = {
    settings: ['setting.%', 'category.%'], keys: ['stripe.%', 'maps.%', 'telegram.%', 'email.%'], plans: ['plans.%'],
    users: ['user.%', 'suspend%', 'delete%'], admins: ['admin.%', 'setup.%'], signin: ['sign_in%'],
  };
  api.get('/activity', async (c) => {
    need(c);
    const page = Math.max(1, Math.min(10_000, Number(c.req.query('page')) || 1));
    const kind = c.req.query('kind') ?? '';
    const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 80);
    const pats = KINDS[kind] ?? null;
    const where = `where ($1::text[] is null or l.action like any($1)) and ($2 = '' or lower(coalesce(a.email, '')) like '%' || $2 || '%' or lower(l.action) like '%' || $2 || '%' or lower(coalesce(l.target, '')) like '%' || $2 || '%')`;
    const { db } = c.get('deps');
    const [rows, total] = await Promise.all([
      db.query(`select l.id, l.action, l.target, l.detail, l.created_at, a.email from audit_log l left join admins a on a.id = l.admin_id ${where} order by l.created_at desc limit 25 offset $3`, [pats, q, (page - 1) * 25]),
      db.query(`select count(*)::int as n from audit_log l left join admins a on a.id = l.admin_id ${where}`, [pats, q]),
    ]);
    return c.json({ rows, total: total[0]!.n, page, pageSize: 25 });
  });

  // ----- categories and rules -----
  api.get('/categories', async (c) => {
    need(c);
    const { db } = c.get('deps');
    const settings = Object.fromEntries((await db.query('select key, value from settings')).map((r) => [r.key, r.value]));
    return c.json({ categories: await db.query('select * from categories order by position'), settings, icons: OWN_ICONS });
  });
  api.post('/categories', async (c) => {
    need(c, 'super');
    const input = await body(c, z.object({
      key: z.string().regex(/^[a-z0-9_]{2,24}$/), name: z.string().max(40), icon: z.string().regex(/^[a-z]{2,16}$/), active: z.boolean(), position: z.number().int().min(0).max(999),
      osm: z.array(z.string().regex(/^(\["[a-z:_]+"(=|~)"[^"\]]{1,80}"(,i)?\])+$/)).max(6), google: z.object({ type: z.string().regex(/^[a-z_]{2,40}$/).optional(), text: z.string().max(60).optional() }),
    }));
    const name = cleanName(input.name, 20);
    if (!name) throw new Fail(422, 'invalid', 'Enter a name.');
    await c.get('deps').db.query(
      `insert into categories (key, name, icon, osm, google, active, position) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (key) do update set name = excluded.name, icon = excluded.icon, osm = excluded.osm, google = excluded.google, active = excluded.active, position = excluded.position`,
      [input.key, name, input.icon, JSON.stringify(input.osm), JSON.stringify(input.google), input.active, input.position],
    );
    await audit(c, 'category.save', input.key, { active: input.active });
    return c.json({ ok: true });
  });
  api.put('/settings', async (c) => {
    need(c, 'super');
    const input = await body(c, z.object({
      places_provider: z.enum(['osm', 'geoapify', 'google']).optional(), routing_provider: z.enum(['estimate', 'osrm', 'ors', 'geoapify', 'onemap', 'google']).optional(), google_budget: z.enum(['50', '75', '90', '100', 'paid']).optional(), own_categories: z.boolean().optional(), blocked_words: z.array(z.string().trim().min(2).max(24)).max(200).optional(),
      group_size: z.object({ free: z.number().int().min(2).max(100), pro: z.number().int().min(2).max(200) }).optional(),
      map_tiles_sg: z.enum(SG_TILE_CHOICES as [TileSourceKey, ...TileSourceKey[]]).optional(),
      map_tiles_world: z.enum(WORLD_TILE_CHOICES as [TileSourceKey, ...TileSourceKey[]]).optional(),
      map_tiles_backup: z.array(z.enum(WORLD_TILE_CHOICES as [TileSourceKey, ...TileSourceKey[]])).max(3).optional(),
      map_start_3d: z.boolean().optional(), map_buildings: z.boolean().optional(), map_animate: z.boolean().optional(),
    }));
    const { db } = c.get('deps');
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      await db.query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, JSON.stringify(value)]);
      await audit(c, 'setting.save', key, { value: key === 'blocked_words' ? `${(value as string[]).length} words` : value });
    }
    return c.json({ ok: true });
  });

  // ----- ads -----
  api.get('/ads', async (c) => {
    need(c);
    const { db } = c.get('deps');
    return c.json({
      placements: await db.query('select * from ad_placements order by key'),
      sponsors: await db.query('select id, name, category_key, url, starts_on, ends_on, active, views from sponsors order by starts_on desc limit 100'),
      adsense: (await one(db, "select value from settings where key = 'adsense'"))?.value ?? { publisherId: '', consent: true },
    });
  });

  // ----- users and plans (hosts only: guests have no account) -----
  api.get('/users', async (c) => {
    const admin = need(c);
    const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 80);
    const plan = c.req.query('plan');
    const page = Math.max(1, Math.min(10_000, Number(c.req.query('page')) || 1));
    const where = `where ($1 = '' or u.email like '%' || $1 || '%' or lower(u.display_name) like '%' || $1 || '%') and ($2::text is null or ($2 = 'suspended' and u.status = 'suspended') or ${PLAN_SQL} = $2)`;
    const args = [q, plan && ['free', 'pro', 'suspended'].includes(plan) ? plan : null];
    const { db } = c.get('deps');
    const [rows, total] = await Promise.all([
      db.query(`select u.id, u.email, u.display_name, u.avatar, ${PLAN_SQL} as plan, (u.plan = 'pro') as paid,
                  (case when u.pro_grant_until > now() and u.pro_grant_until <> 'infinity' then u.pro_grant_until end) as given_until,
                  coalesce(u.pro_grant_until = 'infinity', false) as given_forever, u.pro_grant_note as given_note, u.status, u.totp_enabled, u.created_at, u.last_sign_in_at, (select count(*)::int from meetups m where m.host_id = u.id) as meetups
                from users u ${where} order by u.created_at desc limit 25 offset $3`, [...args, (page - 1) * 25]),
      db.query(`select count(*)::int as n from users u ${where}`, args),
    ]);
    return c.json({ users: rows.map((r) => ({ ...r, email: admin.role === 'super' ? r.email : mask(r.email) })), total: total[0]!.n, page, pageSize: 25 });
  });

  // ----- approvals: propose, then a different admin approves -----
  api.post('/propose', async (c) => {
    const admin = need(c);
    const { action, payload } = await body(c, z.object({ action: z.enum(Object.keys(ACTIONS) as [Action, ...Action[]]), payload: z.unknown() }));
    const parsed = ACTIONS[action].safeParse(payload);
    if (!parsed.success) throw new Fail(422, 'invalid', parsed.error.issues[0]?.message ?? 'That does not look right.');
    const { db } = c.get('deps');
    const admins = Number((await one(db, 'select count(*)::int as n from admins where active'))!.n);
    if (admins === 1 && admin.role === 'super') {
      // With one admin there is nobody to approve. The action runs and the log says so.
      await execute(db, action, parsed.data);
      await audit(c, action, null, { ...parsed.data, approval: 'single admin, self-approved' });
      return c.json({ status: 'done' });
    }
    await db.query('insert into approvals (action, payload, requested_by) values ($1, $2, $3)', [action, JSON.stringify(parsed.data), admin.id]);
    await audit(c, `${action}.proposed`, null, parsed.data as Record<string, unknown>);
    return c.json({ status: 'pending' });
  });
  api.get('/approvals', async (c) => {
    need(c);
    return c.json({ approvals: await c.get('deps').db.query(`select ap.id, ap.action, ap.payload, ap.status, ap.created_at, a.email as requested_by, ap.requested_by as requested_by_id from approvals ap join admins a on a.id = ap.requested_by order by ap.created_at desc limit 50`) });
  });
  api.post('/approvals/:id', async (c) => {
    const admin = need(c);
    const { approve } = await body(c, z.object({ approve: z.boolean() }));
    const { db } = c.get('deps');
    const id = c.req.param('id');
    if (!uuid.safeParse(id).success) throw new Fail(404, 'not_found', 'Not found.');
    const ap = await one(db, "select * from approvals where id = $1 and status = 'pending'", [id]);
    if (!ap) throw new Fail(404, 'not_found', 'That request is no longer waiting.');
    if (ap.requested_by === admin.id) throw new Fail(403, 'forbidden', 'A different admin has to decide this.');
    if (approve) await execute(db, ap.action as Action, ap.payload);
    await db.query('update approvals set status = $2, approved_by = $3, decided_at = now() where id = $1', [id, approve ? 'approved' : 'rejected', admin.id]);
    await audit(c, `${ap.action}.${approve ? 'approved' : 'rejected'}`, id, ap.payload as Record<string, unknown>);
    return c.json({ ok: true });
  });

  // ----- access and audit -----
  api.get('/access', async (c) => {
    need(c);
    const { db } = c.get('deps');
    return c.json({
      admins: await db.query('select id, email, role, active, totp_enabled, created_at from admins order by created_at'),
      audit: (await db.query(`select l.id, l.action, l.target, l.detail, l.created_at, a.email from audit_log l left join admins a on a.id = l.admin_id order by l.created_at desc limit 100`)) as Row[],
    });
  });

  api.route('/', config);
  app.route('/admin/api', api);
  app.all('/admin/api/*', (c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));
  app.onError((err, c) => {
    if (err instanceof Fail) return c.json({ error: err.code, message: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'server', message: 'Something went wrong. Please try again.' }, 500);
  });
  return app;
}

export { hmac };
export type { Env };
export default { fetch: createAdmin().fetch };
