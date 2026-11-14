import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { ART, ICONS } from '@zorion/core';
import { ErrorPage } from './errors';

type R = Record<string, any>;
interface AdminUser { id: string; email: string; role: 'super' | 'support' }

async function call<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/admin/api${path}`, { method, credentials: 'same-origin', headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-zorion': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message ?? 'Something went wrong.'), { status: res.status });
  return data as T;
}
function useLoad<T>(path: string): [T | null, () => void, string | null] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { call<T>('GET', path).then(setData).catch((e) => setError(e.message)); }, [path]);
  useEffect(load, [load]);
  return [data, load, error];
}
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const Toggle = ({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) => <button className="toggle" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}><i /></button>;
const Pill = ({ children, kind }: { children: ReactNode; kind?: string }) => <span className={`pill ${kind ?? ''}`}>{children}</span>;

const PAGES: Array<[path: string, label: string]> = [
  ['/admin', 'Overview'], ['/admin/plans', 'Plans & prices'], ['/admin/payments', 'Payments'], ['/admin/categories', 'Categories'],
  ['/admin/ads', 'Ads'], ['/admin/telegram', 'Telegram'], ['/admin/email', 'Email'], ['/admin/users', 'Users'], ['/admin/access', 'Admins & log'],
];

export default function AdminApp({ path, go }: { path: string; go: (to: string) => void }) {
  const [admin, setAdmin] = useState<AdminUser | null | undefined>(undefined);
  const [down, setDown] = useState(false);
  const refresh = useCallback(() => call('GET', '/me').then((r) => { setAdmin(r.admin); setDown(false); }).catch((e) => { if (e.status && e.status < 500) setAdmin(null); else setDown(true); }), []);
  useEffect(() => { refresh(); }, [refresh]);
  const [setupOpen, setSetupOpen] = useState<boolean | undefined>(undefined);
  useEffect(() => { call<{ open: boolean }>('GET', '/setup').then((r) => setSetupOpen(r.open)).catch(() => setSetupOpen(false)); }, []);
  if (path === '/admin/join') return <Join onDone={() => go('/admin')} />;
  if (down) return <ErrorPage title="The admin portal can't reach its server" text="Try again in a minute." action={<button className="btn solid" onClick={refresh}>Try again</button>} />;
  if (admin === undefined || setupOpen === undefined) return <div className="signin" />;
  if (!admin && setupOpen) return <Setup onDone={() => { setSetupOpen(false); refresh(); }} />;
  if (!admin) return <SignIn onDone={refresh} />;
  const propose = async (action: string, payload: unknown) => {
    const r = await call('POST', '/propose', { action, payload });
    return r.status === 'done' ? 'Done.' : 'Sent to another admin for approval.';
  };
  const known = PAGES.some(([p]) => p === path);
  const page = !known ? <NotFound go={go} />
    : path === '/admin/plans' ? <PlansPage admin={admin} />
    : path === '/admin/payments' ? <Payments admin={admin} />
    : path === '/admin/categories' ? <Categories admin={admin} />
    : path === '/admin/ads' ? <Ads propose={propose} />
    : path === '/admin/telegram' ? <TelegramPage admin={admin} />
    : path === '/admin/email' ? <EmailPage admin={admin} />
    : path === '/admin/users' ? <Users propose={propose} />
    : path === '/admin/access' ? <Access admin={admin} />
    : <Overview go={go} />;
  return (
    <div className="adm">
      <aside>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg viewBox="-6 -14 132 126" width={38} height={36} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART.headChefRim! }} />
          <span className="display" style={{ fontSize: 20 }}>Zorion</span><Pill kind="pro">Admin</Pill>
        </div>
        <nav aria-label="Admin">{PAGES.map(([to, label]) => <a key={to} href={to} aria-current={path === to ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(to); }}>{label}</a>)}</nav>
        <div className="who"><strong style={{ overflowWrap: 'anywhere' }}>{admin.email}</strong><small>{admin.role === 'super' ? 'Super admin' : 'Support admin'}</small>
          <button className="btn" style={{ marginTop: 8, color: '#fff', borderColor: '#33333b' }} onClick={() => call('POST', '/sign-out').then(refresh)}>Sign out</button></div>
      </aside>
      <main>{page}</main>
    </div>
  );
}

function NotFound({ go }: { go: (to: string) => void }) {
  return (
    <section className="errcard" role="alert">
      <svg viewBox="-6 -14 132 126" width={72} height={69} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART.headChef! }} />
      <h1>Page not found</h1>
      <button className="btn solid" onClick={() => go('/admin')}>Back to overview</button>
    </section>
  );
}

/** The authenticator key as a QR code, drawn on this device. */
function Qr({ text }: { text: string }) {
  const [d, setD] = useState<{ n: number; path: string } | null>(null);
  useEffect(() => {
    let live = true;
    import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let path = '';
      for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) path += `M${col} ${r}h1v1h-1z`;
      if (live) setD({ n, path });
    });
    return () => { live = false; };
  }, [text]);
  if (!d) return <div style={{ width: 200, height: 200 }} />;
  return <svg viewBox={`-4 -4 ${d.n + 8} ${d.n + 8}`} width={200} height={200} role="img" aria-label="QR code for your authenticator app" shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 12, alignSelf: 'center' }}><path d={d.path} fill="#0b0b0d" /></svg>;
}

/** First admin: shown only while there are no admins and the Worker has ADMIN_SETUP_TOKEN. */
function Setup({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [key, setKey] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!key) setKey(await call('POST', '/setup/key', { token }));
      else { await call('POST', '/setup', { token, email, password, secret: key.secret, code }); onDone(); }
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="adm signin">
      <form onSubmit={submit}>
        <h1 className="display">Set up the first admin</h1>
        {!key ? (
          <>
            <label>Setup token<input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required /></label>
            <label>Your email<input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label>Password (12+ characters)<input className="input" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          </>
        ) : (
          <>
            <p className="sub">Scan this with your authenticator app, then enter the code it shows.</p>
            <Qr text={key.uri} />
            <p className="sub" style={{ overflowWrap: 'anywhere' }}>Key: <code>{key.secret}</code></p>
            <label>Authenticator code<input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></label>
          </>
        )}
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn solid" disabled={busy}>{key ? 'Create admin' : 'Continue'}</button>
      </form>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'password') { await call('POST', '/sign-in', { email, password }); setStep('code'); }
      else { await call('POST', '/two-step', { code }); onDone(); }
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="adm signin">
      <form onSubmit={submit}>
        <h1 className="display">Zorion admin</h1>
        <p className="sub">{step === 'password' ? 'Password, then authenticator.' : 'Code from your authenticator app.'}</p>
        {step === 'password' ? (
          <>
            <label>Email<input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label>Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          </>
        ) : <label>Authenticator code<input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></label>}
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn solid" disabled={busy}>{step === 'password' ? 'Continue' : 'Verify and sign in'}</button>
      </form>
    </div>
  );
}

/** Join as an admin from an invite link: password, then authenticator. */
function Join({ onDone }: { onDone: () => void }) {
  const token = typeof location !== 'undefined' ? location.hash.slice(1) : '';
  const [invite, setInvite] = useState<{ email: string; role: string; secret: string; uri: string } | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { call('POST', '/join/start', { token }).then(setInvite).catch((e) => setError(e.message)); }, [token]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await call('POST', '/join', { token, password, code }); history.replaceState(null, '', '/admin'); onDone(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  if (!invite) return error ? <ErrorPage title="Invite not valid" text={error} /> : <div className="signin" />;
  return (
    <div className="adm signin">
      <form onSubmit={submit}>
        <h1 className="display">Join Zorion admin</h1>
        <p className="sub" style={{ overflowWrap: 'anywhere' }}>{invite.email} · {invite.role === 'super' ? 'Super admin' : 'Support admin'}</p>
        <label>Password (12+ characters)<input className="input" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <p className="sub">Scan with your authenticator app.</p>
        <Qr text={invite.uri} />
        <p className="sub" style={{ overflowWrap: 'anywhere' }}>Key: <code>{invite.secret}</code></p>
        <label>Authenticator code<input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></label>
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn solid" disabled={busy}>Create my admin account</button>
      </form>
    </div>
  );
}

const Head = ({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) => <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}><div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div></header>;
const Loading = ({ title, error }: { title: string; error: string | null }) => <><Head title={title} sub={error ? undefined : 'Loading…'} />{error && <div className="err">{error}</div>}</>;
const Status = ({ ok, children }: { ok: boolean | null; children: ReactNode }) => <span className={`pill ${ok ? 'live' : ok === false ? 'dark' : ''}`}>{children}</span>;
const Code = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <label>Authenticator code<input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} /></label>;
const Secret = ({ s }: { s: R }) => (s.set ? <span><Status ok>Set</Status> <span className="sub">ends {s.hint}{s.from === 'worker' ? ' · from Cloudflare' : ''}</span></span> : <Status ok={false}>Not set</Status>);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');

/** Runs an admin action and keeps its message, for the small forms on each page. */
function useAct(reload?: () => void): [(fn: () => Promise<unknown>, done?: string) => Promise<void>, boolean, string | null, string | null] {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done = 'Saved.') => {
    setBusy(true); setError(null); setNote(null);
    try { await fn(); setNote(done); reload?.(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return [run, busy, error, note];
}
const Msg = ({ error, note }: { error: string | null; note: string | null }) => (error ? <div className="err" role="alert">{error}</div> : note ? <div className="info" role="status">{note}</div> : null);

function Overview({ go }: { go: (to: string) => void }) {
  const [d, , error] = useLoad<R>('/overview');
  const [pay] = useLoad<R>('/payments');
  const [tg] = useLoad<R>('/telegram');
  const [mail] = useLoad<R>('/email');
  if (!d) return <Loading title="Overview" error={error} />;
  const meetups = d.meetups as Record<string, number>;
  const live = Object.entries(meetups).filter(([k]) => k !== 'ended').reduce((s, [, n]) => s + n, 0);
  const mailFailing = (mail?.last as { ok?: boolean } | null | undefined)?.ok === false;
  const setup: Array<[string, boolean, string, string?]> = [
    ['Payments', !!pay?.key?.set && !!pay?.webhook?.set && !!pay?.prices?.monthly, '/admin/payments'],
    ['Email', !!mail?.key?.set && !mailFailing, '/admin/email', mailFailing ? 'Last send failed' : undefined],
    ['Telegram', !!tg?.token?.set, '/admin/telegram'],
  ];
  return (
    <>
      <Head title="Overview" />
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' }}>
        <section><div className="sub">Hosts</div><div className="stat">{d.users.hosts}</div><div className="sub">{d.users.pro} on Pro · {d.users.suspended} suspended</div></section>
        <section><div className="sub">Meetups in progress</div><div className="stat">{live}</div><div className="sub">{meetups.confirmed ?? 0} confirmed · {meetups.ended ?? 0} ended</div></section>
        <section><div className="sub">Waiting for approval</div><div className="stat">{d.pendingApprovals}</div></section>
      </div>
      <div className="cards">
        <section>
          <h2>Set-up</h2>
          {setup.map(([label, ok, to, why]) => <div className="line" key={label}><span>{label}</span><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Status ok={ok}>{ok ? 'Ready' : why ?? 'Not set up'}</Status><button className="btn" onClick={() => go(to)}>Open</button></span></div>)}
        </section>
        <section><h2>Meetups by stage</h2>{[['draft', 'Draft'], ['date_vote', 'Date vote'], ['voting', 'Food vote'], ['places', 'Picking places'], ['place_vote', 'Place vote'], ['confirmed', 'Confirmed'], ['ended', 'Ended']].map(([k, l]) => <div className="line" key={k}><span>{l}</span><strong>{meetups[k!] ?? 0}</strong></div>)}</section>
      </div>
    </>
  );
}

// ---------- plans and prices ----------
const FEATURES: Array<[key: string, label: string, kind: 'bool' | 'int']> = [
  ['ads', 'Sees ads', 'bool'], ['groupSize', 'People per meetup', 'int'], ['activeMeetups', 'Meetups at a time (0 = no limit)', 'int'],
  ['ownCategories', 'Own food options', 'bool'], ['goldTheme', 'Gold theme', 'bool'], ['guestTheme', 'Gold theme for guests', 'bool'],
];
function PlansPage({ admin }: { admin: AdminUser }) {
  const [d, reload, error] = useLoad<R>('/plans');
  const [p, setP] = useState<R | null>(null);
  const [run, busy, err, note] = useAct(reload);
  useEffect(() => { if (d) setP(structuredClone(d.plans)); }, [d]);
  if (!d || !p) return <Loading title="Plans & prices" error={error} />;
  const edit = admin.role === 'super';
  const set = (plan: 'free' | 'pro', key: string, v: unknown) => setP({ ...p, [plan]: { ...p[plan], [key]: v } });
  const travel = (plan: 'free' | 'pro', mode: string, on: boolean) => set(plan, 'travel', on ? [...new Set([...p[plan].travel, mode])] : p[plan].travel.filter((m: string) => m !== mode));
  const dollars = (cents: number) => (cents ? (cents / 100).toFixed(2) : '');
  const cents = (v: string) => Math.round(Number(v.replace(/[^\d.]/g, '') || '0') * 100);
  return (
    <>
      <Head title="Plans & prices" />
      {!edit && <div className="info">Only super admins can change this page.</div>}
      <div className="cards">
        <section>
          <h2>Pro price (SGD)</h2>
          <label>Monthly<input className="input" inputMode="decimal" placeholder="0.00" disabled={!edit} value={dollars(p.price.monthly)} onChange={(e) => setP({ ...p, price: { ...p.price, monthly: cents(e.target.value) } })} /></label>
          <label>Yearly<input className="input" inputMode="decimal" placeholder="0.00" disabled={!edit} value={dollars(p.price.yearly)} onChange={(e) => setP({ ...p, price: { ...p.price, yearly: cents(e.target.value) } })} /></label>
          <div className="info">Leave empty to stop selling that option. Checkout uses these prices directly.</div>
        </section>
        <section>
          <h2>What each plan includes</h2>
          <table>
            <thead><tr><th>Feature</th><th>Free</th><th>Pro</th></tr></thead>
            <tbody>
              {FEATURES.map(([key, label, kind]) => (
                <tr key={key}><td>{label}</td>{(['free', 'pro'] as const).map((plan) => <td key={plan}>{kind === 'bool'
                  ? <Toggle on={!!p[plan][key]} label={`${label}, ${plan}`} disabled={!edit} onChange={(v) => set(plan, key, v)} />
                  : <input className="input" style={{ width: 80 }} type="number" min={key === 'groupSize' ? 2 : 0} max={200} disabled={!edit} value={p[plan][key]} onChange={(e) => set(plan, key, Number(e.target.value))} />}</td>)}</tr>
              ))}
              {[['cycle', 'Cycling times'], ['transit', 'Transit times']].map(([mode, label]) => (
                <tr key={mode}><td>{label}</td>{(['free', 'pro'] as const).map((plan) => <td key={plan}><Toggle on={p[plan].travel.includes(mode)} label={`${label}, ${plan}`} disabled={!edit} onChange={(v) => travel(plan, mode!, v)} /></td>)}</tr>
              ))}
            </tbody>
          </table>
          <div className="info">Walking times are always included. Transit needs Google routes (Categories page has the routing choice).</div>
        </section>
      </div>
      <Msg error={err} note={note} />
      {edit && <div><button className="btn solid" disabled={busy} onClick={() => run(() => call('PUT', '/plans', { free: p.free, pro: p.pro, price: { monthly: p.price.monthly, yearly: p.price.yearly } }))}>Save plans and prices</button></div>}
    </>
  );
}

// ---------- payments ----------
function Payments({ admin }: { admin: AdminUser }) {
  const [d, reload, error] = useLoad<R>('/payments');
  const [check, setCheck] = useState<R | null>(null);
  const [key, setKey] = useState('');
  const [code, setCode] = useState('');
  const [run, busy, err, note] = useAct(reload);
  if (!d) return <Loading title="Payments" error={error} />;
  const edit = admin.role === 'super';
  const done = () => setCode('');
  return (
    <>
      <Head title="Payments" sub="Stripe"><button className="btn" disabled={!d.key.set || busy} onClick={() => run(async () => setCheck(await call('POST', '/payments/check')), 'Checked.')}>Check connection</button></Head>
      <div className="cards">
        <section>
          <h2>Status</h2>
          <div className="line"><span>Secret key</span><Secret s={d.key} /></div>
          <div className="line"><span>Mode</span>{d.mode ? <Status ok={d.mode === 'live'}>{d.mode === 'live' ? 'Live' : 'Test'}</Status> : <span className="sub">—</span>}</div>
          <div className="line"><span>Webhook</span>{d.webhook.set ? <Status ok>Connected</Status> : <Status ok={false}>Not connected</Status>}</div>
          <div className="line"><span>Last event from Stripe</span><span>{when(d.lastEventAt)}</span></div>
          <div className="line"><span>Active subscriptions</span><strong>{d.subscriptions?.live ?? 0}</strong></div>
          <div className="line"><span>Prices</span><span>{d.prices.monthly ? `S$${(d.prices.monthly / 100).toFixed(2)} / month` : 'Monthly not set'} · {d.prices.yearly ? `S$${(d.prices.yearly / 100).toFixed(2)} / year` : 'Yearly not set'}</span></div>
          {check?.account && <>
            <div className="line"><span>Account</span><strong>{check.account.name} ({check.account.country})</strong></div>
            <div className="line"><span>Can take payments</span><Status ok={check.account.charges}>{check.account.charges ? 'Yes' : 'No'}</Status></div>
            <div className="line"><span>Webhook in Stripe</span>{check.webhook ? <Status ok={check.webhook.status === 'enabled' && check.webhook.events}>{check.webhook.status === 'enabled' && check.webhook.events ? 'Enabled' : 'Needs reconnecting'}</Status> : <Status ok={false}>Missing</Status>}</div>
          </>}
        </section>
        {edit && <section>
          <h2>Keys</h2>
          <label>Stripe secret key<input className="input" type="password" autoComplete="off" placeholder="sk_live_… or sk_test_…" value={key} onChange={(e) => setKey(e.target.value.trim())} /></label>
          <Code value={code} onChange={setCode} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn solid" disabled={busy || !key || code.length !== 6} onClick={() => run(async () => { await call('PUT', '/payments/key', { secretKey: key, code }); setKey(''); done(); }, 'Key saved.')}>Save key</button>
            <button className="btn" disabled={busy || !d.key.set || code.length !== 6} onClick={() => run(async () => { await call('POST', '/payments/webhook', { code }); done(); }, 'Webhook connected.')}>{d.webhook.set ? 'Reconnect webhook' : 'Connect webhook'}</button>
            <button className="btn" disabled={busy || !d.key.set || code.length !== 6} onClick={() => run(async () => { await call('POST', '/payments/remove', { code }); done(); }, 'Stripe removed.')}>Remove</button>
          </div>
          <div className="info">Connecting creates the webhook in Stripe for <code>{d.webhookUrl}</code>. Keys are stored encrypted and never shown again.</div>
        </section>}
      </div>
      <Msg error={err} note={note} />
    </>
  );
}

// ---------- categories ----------
interface Cat { key: string; name: string; icon: string; active: boolean; position: number; osm: string[]; google: { type?: string; text?: string } }
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
function Categories({ admin }: { admin: AdminUser }) {
  const [d, reload, error] = useLoad<R>('/categories');
  const [icons] = useLoad<{ icons: string[] }>('/icons');
  const [form, setForm] = useState<(Cat & { isNew: boolean; words: string }) | null>(null);
  const [words, setWords] = useState<string | null>(null);
  const [run, busy, err, note] = useAct(reload);
  if (!d) return <Loading title="Categories" error={error} />;
  const edit = admin.role === 'super';
  const s = d.settings as R;
  const cats = d.categories as Cat[];
  const save = (body: R) => run(() => call('PUT', '/settings', body));
  const toggle = (c: Cat, active: boolean) => run(() => call('POST', '/categories', { ...c, active }));
  const open = (c?: Cat) => setForm(c ? { ...c, isNew: false, words: '' } : { key: '', name: '', icon: 'star', active: true, position: (cats.at(-1)?.position ?? 0) + 1, osm: [], google: { text: '' }, isNew: true, words: '' });
  const submit = () => form && run(async () => {
    const cuisine = form.words.toLowerCase().split(/[,|]/).map((w) => w.trim().replace(/[^a-z_ ]/g, '').replace(/ /g, '_')).filter(Boolean);
    const osm = cuisine.length ? [`["amenity"~"restaurant|fast_food|cafe|bar|pub"]["cuisine"~"${cuisine.join('|')}"]`] : form.osm;
    const key = form.isNew ? slug(form.name) : form.key;
    if (key.length < 2) throw new Error('Enter a name.');
    const google = form.google.type ? { type: form.google.type } : { text: (form.google.text || form.name).slice(0, 60) };
    await call('POST', '/categories', { key, name: form.name, icon: form.icon, active: form.active, position: form.position, osm, google });
    setForm(null);
  });
  return (
    <>
      <Head title="Categories">{edit && <button className="btn solid" onClick={() => open()}>Add category</button>}</Head>
      <Msg error={err} note={note} />
      <div className="cards split">
        <section>
          <h2>Food options hosts can pick</h2>
          <table><thead><tr><th>Name</th><th>Search</th><th>On</th><th /></tr></thead>
            <tbody>{cats.map((c) => (
              <tr key={c.key}>
                <td className="nowrap"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[c.icon] ?? ICONS.star! }} /><strong>{c.name}</strong></span></td>
                <td className="sub">{c.google?.type ?? c.google?.text ?? '—'}</td>
                <td><Toggle on={c.active} label={`${c.name} on`} disabled={!edit} onChange={(v) => toggle(c, v)} /></td>
                <td className="nowrap">{edit && <span style={{ display: 'flex', gap: 6 }}><button className="btn" onClick={() => open(c)}>Edit</button><button className="btn" onClick={() => run(() => call('DELETE', `/categories/${c.key}`), 'Removed.')}>Remove</button></span>}</td>
              </tr>
            ))}</tbody></table>
        </section>
        {form ? (
          <section>
            <h2>{form.isNew ? 'New category' : `Edit ${form.name}`}</h2>
            <label>Name<input className="input" maxLength={20} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <div><div style={{ fontWeight: 600, marginBottom: 6 }}>Icon</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{(icons?.icons ?? []).map((i) => <button key={i} type="button" className="btn" aria-label={i} aria-pressed={form.icon === i} style={{ width: 44, padding: 0, ...(form.icon === i ? { background: 'var(--ink)', color: '#fff' } : {}) }} onClick={() => setForm({ ...form, icon: i })}><svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[i]! }} /></button>)}</div></div>
            <label>Google search words<input className="input" maxLength={60} placeholder={form.name || 'e.g. hotpot'} value={form.google.type ? form.google.type : form.google.text ?? ''} onChange={(e) => setForm({ ...form, google: { text: e.target.value } })} /></label>
            <label>OpenStreetMap cuisine words, comma separated<input className="input" placeholder={form.osm.length ? 'Leave empty to keep the current search' : 'e.g. hotpot, steamboat'} value={form.words} onChange={(e) => setForm({ ...form, words: e.target.value })} /></label>
            <div className="line"><span>On</span><Toggle on={form.active} label="On" onChange={(v) => setForm({ ...form, active: v })} /></div>
            <div style={{ display: 'flex', gap: 8 }}><button className="btn solid" disabled={busy || !form.name.trim()} onClick={submit}>Save</button><button className="btn" onClick={() => setForm(null)}>Cancel</button></div>
          </section>
        ) : (
          <section>
            <h2>Rules</h2>
            <div className="line"><span>Places come from</span><select className="input" style={{ width: 210 }} aria-label="Places come from" value={s.places_provider} disabled={!edit} onChange={(e) => save({ places_provider: e.target.value })}><option value="osm">OpenStreetMap (free)</option><option value="google">Google Places (needs a key)</option></select></div>
            <div className="line"><span>Trip times come from</span><select className="input" style={{ width: 210 }} aria-label="Trip times come from" value={s.routing_provider ?? 'estimate'} disabled={!edit} onChange={(e) => save({ routing_provider: e.target.value })}><option value="estimate">Zorion's estimate</option><option value="osrm">OpenStreetMap routing (free)</option><option value="ors">openrouteservice (free key)</option><option value="google">Google routes (paid key)</option></select></div>
            <label>Blocked words in names, one per line<textarea className="input" style={{ minHeight: 110, padding: 12 }} disabled={!edit} value={words ?? (s.blocked_words ?? []).join('\n')} onChange={(e) => setWords(e.target.value)} /></label>
            <button className="btn" disabled={!edit || words === null} onClick={() => save({ blocked_words: (words ?? '').split('\n').map((w) => w.trim()).filter((w) => w.length > 1) })}>Save blocked words</button>
          </section>
        )}
      </div>
    </>
  );
}

// ---------- ads ----------
function Ads({ propose }: { propose: (action: string, payload: unknown) => Promise<string> }) {
  const [d, reload, error] = useLoad<R>('/ads');
  const [form, setForm] = useState({ name: '', categoryKey: '', url: '', startsOn: '', endsOn: '' });
  const [g, setG] = useState<{ publisherId: string; slot: string } | null>(null);
  const [run, busy, err, note] = useAct(reload);
  if (!d) return <Loading title="Ads" error={error} />;
  const act = (action: string, payload: unknown) => run(() => propose(action, payload).then((m) => { if (m !== 'Done.') throw Object.assign(new Error(m), { info: true }); }), 'Done.');
  const today = new Date().toISOString().slice(0, 10);
  const ad = { publisherId: d.adsense.publisherId ?? '', slot: d.adsense.slot ?? '', consent: d.adsense.consent !== false };
  const form2 = g ?? { publisherId: ad.publisherId, slot: ad.slot };
  return (
    <>
      <Head title="Ads" sub="Free users see ads in the app. Pro users see none." />
      <Msg error={err} note={note} />
      <div className="cards">
        <section>
          <h2>Google ads</h2>
          <label>Publisher ID<input className="input" placeholder="ca-pub-…" value={form2.publisherId} onChange={(e) => setG({ ...form2, publisherId: e.target.value.trim() })} /></label>
          <label>Ad unit ID<input className="input" inputMode="numeric" placeholder="e.g. 1234567890" value={form2.slot} onChange={(e) => setG({ ...form2, slot: e.target.value.replace(/\D/g, '') })} /></label>
          <div className="line"><span>Ask before showing Google ads</span><Toggle on={ad.consent} label="Ask before showing Google ads" onChange={(consent) => act('ads.adsense', { ...form2, consent })} /></div>
          <button className="btn" disabled={busy || g === null} onClick={() => act('ads.adsense', { ...form2, consent: ad.consent })}>Save</button>
          <div className="info">Google ads load in a separate frame from zorion.midnightpoetry.studio, so they can't see the app. If no Google ad shows, the slot shows a sponsored spot instead.</div>
        </section>
        <section>
          <h2>Ad spots</h2>
          <table><thead><tr><th>Where</th><th>Shows</th><th>On</th></tr></thead>
            <tbody>{(d.placements as R[]).map((p) => <tr key={p.key}><td><strong>{p.label}</strong></td><td><Pill kind={p.kind === 'adsense' ? 'dark' : ''}>{p.kind === 'adsense' ? 'Google, then sponsored' : 'Sponsored'}</Pill></td><td><Toggle on={p.enabled} label={p.label} onChange={(enabled) => act('ads.placement', { key: p.key, enabled })} /></td></tr>)}</tbody></table>
        </section>
        <section>
          <h2>Sponsored spots</h2>
          <table><thead><tr><th>Sponsor</th><th>Category</th><th>Runs</th><th>Views</th></tr></thead>
            <tbody>{(d.sponsors as R[]).length === 0 ? <tr><td colSpan={4} className="sub">None yet.</td></tr> : (d.sponsors as R[]).map((s) => <tr key={s.id}><td><strong>{s.name}</strong></td><td>{s.category_key ?? 'Any'}</td><td>{date(s.starts_on)} to {date(s.ends_on)} {s.starts_on.slice(0, 10) <= today && s.ends_on.slice(0, 10) >= today ? <Pill kind="live">Live</Pill> : null}</td><td>{s.views}</td></tr>)}</tbody></table>
        </section>
        <section>
          <h2>New sponsored spot</h2>
          <label>Sponsor name<input className="input" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Category key (empty for any)<input className="input" value={form.categoryKey} onChange={(e) => setForm({ ...form, categoryKey: e.target.value })} /></label>
          <label>Link (https), optional<input className="input" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><label>Starts<input className="input" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></label><label>Ends<input className="input" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></label></div>
          <button className="btn solid" disabled={busy || !form.name.trim() || !form.startsOn || !form.endsOn} onClick={() => act('ads.sponsor', { name: form.name, categoryKey: form.categoryKey.trim() || null, url: form.url.trim() || null, startsOn: form.startsOn, endsOn: form.endsOn })}>Add</button>
          <div className="info">Ad changes need a second admin when there is more than one.</div>
        </section>
      </div>
    </>
  );
}

// ---------- Telegram ----------
function TelegramPage({ admin }: { admin: AdminUser }) {
  const [d, reload, error] = useLoad<R>('/telegram');
  const [check, setCheck] = useState<R | null>(null);
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [run, busy, err, note] = useAct(reload);
  if (!d) return <Loading title="Telegram" error={error} />;
  const edit = admin.role === 'super';
  return (
    <>
      <Head title="Telegram" sub="Updates by Telegram, same as email."><button className="btn" disabled={!d.token.set || busy} onClick={() => run(async () => setCheck(await call('POST', '/telegram/check')), 'Checked.')}>Check bot</button></Head>
      <div className="cards">
        <section>
          <h2>Status</h2>
          <div className="line"><span>Bot</span>{d.username ? <strong>@{d.username}</strong> : <Status ok={false}>Not set up</Status>}</div>
          <div className="line"><span>Token</span><Secret s={d.token} /></div>
          {check?.webhook && <>
            <div className="line"><span>Receiving messages</span><Status ok={check.webhook.connected}>{check.webhook.connected ? 'Yes' : 'No'}</Status></div>
            <div className="line"><span>Waiting messages</span><strong>{check.webhook.pending}</strong></div>
            {check.webhook.lastError && <div className="err">{check.webhook.lastError}</div>}
          </>}
        </section>
        {edit && <section>
          <h2>{d.token.set ? 'Change bot' : 'Connect a bot'}</h2>
          <ol className="sub" style={{ margin: 0, paddingLeft: 18 }}><li>In Telegram, message @BotFather and send /newbot.</li><li>Paste the token it gives you here.</li></ol>
          <label>Bot token<input className="input" type="password" autoComplete="off" placeholder="123456789:AA…" value={token} onChange={(e) => setToken(e.target.value.trim())} /></label>
          <Code value={code} onChange={setCode} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn solid" disabled={busy || !token || code.length !== 6} onClick={() => run(async () => { await call('PUT', '/telegram', { token, code }); setToken(''); setCode(''); }, 'Bot connected.')}>Connect</button>
            {d.token.set && <button className="btn" disabled={busy || code.length !== 6} onClick={() => run(async () => { await call('POST', '/telegram/remove', { code }); setCode(''); setCheck(null); }, 'Bot disconnected.')}>Disconnect</button>}
          </div>
          <div className="info">Zorion sets the bot's webhook and secret itself.</div>
        </section>}
      </div>
      <Msg error={err} note={note} />
    </>
  );
}

// ---------- email ----------
interface EmailStatus { ok: boolean; at: string; from: string; key: 'portal' | 'worker' | 'none'; reason?: string }
const KEY_FROM = { portal: 'the key saved here', worker: 'the key set on zorion-app in Cloudflare', none: 'no key' } as const;

/** What happened the last time the app tried to send an email, so a failure is never a mystery. */
function LastEmail({ last }: { last: EmailStatus | null }) {
  if (!last) return <div className="line"><span>Last email from the app</span><strong>None yet</strong></div>;
  return (
    <>
      <div className="line"><span>Last email from the app</span><strong>{last.ok ? 'Sent' : 'Failed'}, {new Date(last.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong></div>
      {!last.ok && <div className="err" role="status" style={{ overflowWrap: 'anywhere' }}>{last.reason}<br /><span className="sub">Sent from {last.from || 'no address'}, using {KEY_FROM[last.key]}.</span></div>}
    </>
  );
}

function EmailPage({ admin }: { admin: AdminUser }) {
  const [d, reload, error] = useLoad<R>('/email');
  const [key, setKey] = useState('');
  const [from, setFrom] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [run, busy, err, note] = useAct(reload);
  if (!d) return <Loading title="Email" error={error} />;
  const edit = admin.role === 'super';
  return (
    <>
      <Head title="Email" sub="Sign-in codes and updates, sent through Resend." />
      <div className="cards">
        <section>
          <h2>Status</h2>
          <div className="line"><span>Resend key</span><Secret s={d.key} /></div>
          <div className="line"><span>Sent from</span><strong style={{ overflowWrap: 'anywhere' }}>{d.from}</strong></div>
          <LastEmail last={d.last as EmailStatus | null} />
          {edit && <button className="btn" disabled={busy || !d.key.set} onClick={() => run(async () => { const r = await call('POST', '/email/test'); return r; }, 'Test email sent to you.')}>Send me a test email</button>}
        </section>
        {edit && <section>
          <h2>Settings</h2>
          <label>Resend API key<input className="input" type="password" autoComplete="off" placeholder={d.key.set ? 'Leave empty to keep the current key' : 're_…'} value={key} onChange={(e) => setKey(e.target.value.trim())} /></label>
          <label>Send from<input className="input" value={from ?? d.from} onChange={(e) => setFrom(e.target.value)} /></label>
          <Code value={code} onChange={setCode} />
          <button className="btn solid" disabled={busy || code.length !== 6} onClick={() => run(async () => { await call('PUT', '/email', { ...(key ? { apiKey: key } : {}), from: from ?? d.from, code }); setKey(''); setCode(''); })}>Save</button>
          <div className="info">The address must be on a domain verified in Resend, such as app.midnightpoetry.studio.</div>
        </section>}
      </div>
      <Msg error={err} note={note} />
    </>
  );
}

function Users({ propose }: { propose: (action: string, payload: unknown) => Promise<string> }) {
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('');
  // Wait for a pause in typing before asking the server.
  useEffect(() => { const t = setTimeout(() => setQ(typed.trim()), 300); return () => clearTimeout(t); }, [typed]);
  const [d, reload, error] = useLoad<R>(`/users?q=${encodeURIComponent(q)}&plan=${plan}`);
  const [sel, setSel] = useState<R | null>(null);
  const [sure, setSure] = useState(false);
  useEffect(() => setSure(false), [sel]);
  const [note, setNote] = useState<string | null>(null);
  const act = (action: string, payload: unknown) => propose(action, payload).then((m) => { setNote(m); setSel(null); reload(); }).catch((e) => setNote(e.message));
  return (
    <>
      <Head title="Users" sub="Hosts. Guests have no account."><input className="input" style={{ width: 260 }} placeholder="Search by email" aria-label="Search hosts" value={typed} maxLength={80} onChange={(e) => setTyped(e.target.value)} /></Head>
      {note && <div className="info" role="status">{note}</div>}
      {error && <div className="err">{error}</div>}
      <div className="cards">
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}><h2>Hosts</h2><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[['', 'All'], ['free', 'Free'], ['pro', 'Pro'], ['suspended', 'Suspended']].map(([v, l]) => <button key={v} className="btn" aria-pressed={plan === v} style={plan === v ? { background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' } : undefined} onClick={() => setPlan(v!)}>{l}</button>)}</div></div>
          <table><thead><tr><th>Host</th><th>Plan</th><th>Meetups</th><th>Joined</th><th>Two-step</th></tr></thead>
            <tbody>{(d?.users as R[] | undefined)?.map((u) => <tr key={u.id} onClick={() => setSel(u)} style={{ cursor: 'pointer', background: sel?.id === u.id ? 'var(--card)' : undefined }}><td><strong>{u.email}</strong></td><td>{u.status === 'suspended' ? <Pill kind="dark">Suspended</Pill> : <Pill kind={u.plan === 'pro' ? 'pro' : ''}>{u.plan === 'pro' ? 'Pro' : 'Free'}</Pill>}</td><td>{u.meetups}</td><td>{date(u.created_at)}</td><td><Pill>{u.totp_enabled ? 'On' : 'Off'}</Pill></td></tr>) ?? <tr><td colSpan={5} className="sub">Loading…</td></tr>}{d && (d.users as R[]).length === 0 && <tr><td colSpan={5} className="sub">No hosts match.</td></tr>}</tbody></table>
          <div className="sub">Emails are masked for support admins.</div>
        </section>
        <section>
          {!sel ? <div className="info">Pick a host to see more.</div> : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><h2 style={{ overflowWrap: 'anywhere' }}>{sel.email}</h2><Pill kind={sel.plan === 'pro' ? 'pro' : ''}>{sel.plan === 'pro' ? 'Pro' : 'Free'}</Pill></div>
              <div><div className="line"><span className="sub">Plan</span><strong>{sel.plan === 'pro' ? 'Pro, billed by Stripe' : 'Free'}</strong></div><div className="line"><span className="sub">Meetups hosted</span><strong>{sel.meetups}</strong></div><div className="line"><span className="sub">Last sign-in</span><strong>{date(sel.last_sign_in_at)}</strong></div><div className="line"><span className="sub">Two-step</span><strong>{sel.totp_enabled ? 'On' : 'Off'}</strong></div></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button className="btn" onClick={() => act('user.suspend', { userId: sel.id, suspend: sel.status !== 'suspended' })}>{sel.status === 'suspended' ? 'Lift suspension' : 'Suspend account'}</button>
                {sure
                  ? <><button className="btn solid" onClick={() => act('user.delete', { userId: sel.id })}>Yes, delete everything</button><button className="btn" onClick={() => setSure(false)}>Keep</button></>
                  : <button className="btn" onClick={() => setSure(true)}>Delete data</button>}
              </div>
              {sure && <div className="err" role="alert">This deletes the host and all their meetups. It can't be undone.</div>}
              <div className="info">Suspending or deleting needs a second admin when there is more than one.</div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function Access({ admin }: { admin: AdminUser }) {
  const [d, reload, error] = useLoad<R>('/access');
  const [ap, reloadAp] = useLoad<R>('/approvals');
  const [invite, setInvite] = useState({ email: '', role: 'support' });
  const [link, setLink] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [run, busy, err, note] = useAct(() => { reload(); reloadAp(); });
  const decide = (id: string, approve: boolean) => run(() => call('POST', `/approvals/${id}`, { approve }), approve ? 'Approved.' : 'Rejected.');
  const pending = ((ap?.approvals as R[] | undefined) ?? []).filter((a) => a.status === 'pending');
  const sup = admin.role === 'super';
  return (
    <>
      <Head title="Admins & log" />
      {error && <div className="err">{error}</div>}
      <Msg error={err} note={note} />
      <div className="cards">
        <section>
          <h2>Waiting for a second admin</h2>
          {pending.length ? pending.map((a) => (
            <div className="line" key={a.id}><span><strong>{a.action}</strong><br /><span className="sub">{a.requested_by}</span></span>{a.requested_by_id === admin.id ? <Pill>Yours</Pill> : <span style={{ display: 'flex', gap: 6 }}><button className="btn" onClick={() => decide(a.id, false)}>Reject</button><button className="btn solid" onClick={() => decide(a.id, true)}>Approve</button></span>}</div>
          )) : <div className="info">Nothing waiting.</div>}
          <h2>Admins</h2>
          <table><thead><tr><th>Admin</th><th>Role</th><th /></tr></thead><tbody>{(d?.admins as R[] | undefined)?.map((a) => <tr key={a.id}><td><strong>{a.email}</strong>{!a.active && <> <Pill kind="dark">Off</Pill></>}</td><td>{a.role === 'super' ? 'Super' : 'Support'}</td><td>{sup && a.id !== admin.id && <button className="btn" disabled={busy || code.length !== 6} onClick={() => run(() => call('POST', `/admins/${a.id}/active`, { active: !a.active, code }).then(() => setCode('')))}>{a.active ? 'Switch off' : 'Switch on'}</button>}</td></tr>)}</tbody></table>
          {sup && <>
            <h2>Invite an admin</h2>
            <label>Email<input className="input" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></label>
            <label>Role<select className="input" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}><option value="support">Support (read-only, emails masked)</option><option value="super">Super (full access)</option></select></label>
            <Code value={code} onChange={setCode} />
            <button className="btn solid" disabled={busy || !invite.email || code.length !== 6} onClick={() => run(async () => { setLink((await call('POST', '/admins/invite', { ...invite, code })).link); setCode(''); }, 'Invite ready. Send the link; it works once, for 24 hours.')}>Create invite link</button>
            {link && <div className="info" style={{ overflowWrap: 'anywhere' }}><code>{link}</code> <button className="btn" onClick={() => navigator.clipboard?.writeText(link)}>Copy</button></div>}
          </>}
        </section>
        <section>
          <h2>Log</h2>
          <table><thead><tr><th>When</th><th>Who</th><th>Action</th></tr></thead>
            <tbody>{(d?.audit as R[] | undefined)?.map((l) => <tr key={l.id}><td className="sub">{new Date(l.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>{l.email ?? '—'}</td><td><strong>{l.action}</strong>{l.target ? ` · ${l.target}` : ''}</td></tr>)}</tbody></table>
        </section>
      </div>
    </>
  );
}
