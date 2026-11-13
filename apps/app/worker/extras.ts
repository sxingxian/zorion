import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '@zorion/db';
import { type App, type Deps, Fail, body, requireUser } from './core';
import { hmac, safeEqual } from './crypto';

// ---------- Stripe (hosted Checkout and customer portal; card details never reach Zorion) ----------
async function stripe(deps: Deps, path: string, form: Record<string, string>): Promise<any> {
  if (!deps.env.STRIPE_SECRET_KEY) throw new Fail(409, 'billing_off', 'Billing is not set up yet.');
  const res = await deps.fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${deps.env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Stripe refused ${path} (${res.status})`);
  return res.json();
}

export const billing = new Hono<App>();

billing.post('/checkout', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const { period } = await body(c, z.object({ period: z.enum(['monthly', 'yearly']) }));
  const price = period === 'yearly' ? deps.env.STRIPE_PRICE_YEARLY : deps.env.STRIPE_PRICE_MONTHLY;
  if (!price) throw new Fail(409, 'billing_off', 'Billing is not set up yet.');
  if (user.plan === 'pro') throw new Fail(409, 'already_pro', 'You are already on Pro.');
  const session = await stripe(deps, 'checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    customer_email: user.email,
    client_reference_id: user.id,
    success_url: `${deps.env.APP_ORIGIN}/pro/welcome`,
    cancel_url: `${deps.env.APP_ORIGIN}/pro`,
  });
  return c.json({ url: session.url as string });
});

billing.post('/portal', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const row = (await deps.db.query('select stripe_customer_id from users where id = $1', [user.id]))[0];
  if (!row?.stripe_customer_id) throw new Fail(409, 'no_billing', 'There is no subscription to manage.');
  const session = await stripe(deps, 'billing_portal/sessions', { customer: row.stripe_customer_id, return_url: `${deps.env.APP_ORIGIN}/account` });
  return c.json({ url: session.url as string });
});

/** Verifies the Stripe-Signature header: HMAC-SHA256 over "timestamp.payload", five-minute tolerance. */
export async function verifyStripeSignature(payload: string, header: string | undefined, secret: string, now: Date): Promise<boolean> {
  const parts = Object.fromEntries((header ?? '').split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now.getTime() / 1000 - t) > 300) return false;
  return safeEqual(await hmac(secret, `${t}.${payload}`), parts.v1);
}

async function setPlan(db: Db, where: { userId?: string; customer?: string }, plan: 'free' | 'pro', customer?: string, sub?: { id: string; status: string; periodEnd: number | null }) {
  const user = where.userId
    ? (await db.query('select id from users where id = $1', [where.userId]))[0]
    : (await db.query('select id from users where stripe_customer_id = $1', [where.customer]))[0];
  if (!user) return;
  await db.query('update users set plan = $2, stripe_customer_id = coalesce($3, stripe_customer_id), theme = case when $2 = $4 then theme else $5 end where id = $1', [user.id, plan, customer ?? null, 'pro', 'gold']);
  if (sub) {
    await db.query(
      `insert into subscriptions (user_id, stripe_subscription_id, status, current_period_end) values ($1, $2, $3, to_timestamp($4::double precision))
       on conflict (user_id) do update set stripe_subscription_id = excluded.stripe_subscription_id, status = excluded.status, current_period_end = excluded.current_period_end, updated_at = now()`,
      [user.id, sub.id, sub.status, sub.periodEnd ?? 0],
    );
  }
}

export const webhooks = new Hono<App>();

webhooks.post('/stripe', async (c) => {
  const deps = c.get('deps');
  const payload = await c.req.text();
  const secret = deps.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !(await verifyStripeSignature(payload, c.req.header('stripe-signature'), secret, deps.now()))) throw new Fail(400, 'bad_signature', 'Signature check failed.');
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: any } };
  // Stripe may deliver an event more than once.
  const first = await deps.db.query('insert into stripe_events (id) values ($1) on conflict do nothing returning id', [event.id]);
  if (first.length === 0) return c.json({ ok: true });
  const o = event.data.object;
  if (event.type === 'checkout.session.completed' && o.mode === 'subscription' && o.client_reference_id) {
    await setPlan(deps.db, { userId: o.client_reference_id }, 'pro', o.customer, { id: o.subscription, status: 'active', periodEnd: null });
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const live = event.type !== 'customer.subscription.deleted' && ['active', 'trialing', 'past_due'].includes(o.status);
    await setPlan(deps.db, { customer: o.customer }, live ? 'pro' : 'free', undefined, { id: o.id, status: o.status, periodEnd: o.current_period_end ?? null });
  }
  return c.json({ ok: true });
});

// ---------- sponsored slots (first-party only: no ad network runs inside the app) ----------
export const ads = new Hono<App>();

ads.get('/:placement', async (c) => {
  const { db } = c.get('deps');
  const placement = c.req.param('placement');
  if (c.get('user')?.plan === 'pro') return c.json({ ad: null });
  const on = (await db.query("select 1 from ad_placements where key = $1 and enabled and kind = 'sponsored'", [placement]))[0];
  if (!on) return c.json({ ad: null });
  const category = c.req.query('category') ?? null;
  const row = (await db.query(
    `update sponsors set views = views + 1 where id = (
       select id from sponsors where active and current_date between starts_on and ends_on and (category_key is null or category_key = $1)
       order by (category_key is not null) desc, random() limit 1) returning name, url`,
    [category],
  ))[0];
  return c.json({ ad: row ? { name: row.name, url: row.url && /^https:\/\//.test(row.url) ? row.url : null } : null });
});

// ---------- scheduled clean-up ----------
/** Ends old meetups, deletes their locations, and clears expired sessions, codes and locks. */
export async function cleanUp(db: Db): Promise<void> {
  await db.batch([
    ["update meetups set status = 'ended', updated_at = now() where status <> 'ended' and starts_at is not null and starts_at < now() - interval '24 hours'", []],
    ["update participants set lat = null, lng = null where meetup_id in (select id from meetups where status = 'ended') and lat is not null", []],
    ["delete from guest_devices where participant_id in (select p.id from participants p join meetups m on m.id = p.meetup_id where m.status = 'ended')", []],
    ["delete from meetups where status = 'ended' and updated_at < now() - interval '90 days'", []],
    ['delete from sessions where expires_at < now()', []],
    ["delete from email_codes where expires_at < now() - interval '1 day'", []],
    ["delete from throttles where coalesce(locked_until, window_start) < now() - interval '1 day'", []],
    ["delete from stripe_events where received_at < now() - interval '30 days'", []],
  ]);
}
