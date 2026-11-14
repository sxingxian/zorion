import { type ReactElement, type ReactNode, cloneElement, createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
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

const PAGES: Array<[path: string, label: string]> = [
  ['/admin', 'Overview'], ['/admin/plans', 'Plans'], ['/admin/payments', 'Payments'], ['/admin/categories', 'Categories'],
  ['/admin/ads', 'Ads'], ['/admin/telegram', 'Telegram'], ['/admin/email', 'Email'], ['/admin/users', 'Users'], ['/admin/access', 'Admins'],
];

export default function AdminApp({ path, go }: { path: string; go: (to: string) => void }) {
  const [admin, setAdmin] = useState<AdminUser | null | undefined>(undefined);
  const [down, setDown] = useState(false);
  const refresh = useCallback(() => call('GET', '/me').then((r) => { setAdmin(r.admin); setDown(false); }).catch((e) => { if (e.status && e.status < 500) setAdmin(null); else setDown(true); }), []);
  useEffect(() => { refresh(); }, [refresh]);
  const [setupOpen, setSetupOpen] = useState<boolean | undefined>(undefined);
  useEffect(() => { call<{ open: boolean }>('GET', '/setup').then((r) => setSetupOpen(r.open)).catch(() => setSetupOpen(false)); }, []);
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState<{ text: string; n: number } | null>(null);
  const [ask, setAsk] = useState<{ title: string; action: (code: string) => Promise<unknown>; done: (ran: boolean) => void } | null>(null);
  const dirty = useRef(false);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 2400); return () => clearTimeout(t); }, [note]);
  const kit = useMemo<Kit>(() => ({
    confirm: (title, action) => new Promise<boolean>((resolve) => setAsk({ title, action, done: resolve })),
    toast: (text) => setNote({ text, n: Date.now() }),
    setDirty: (v) => { dirty.current = v; },
    go: (to) => {
      if (dirty.current && !window.confirm('Leave without saving your changes?')) return;
      dirty.current = false;
      setMenu(false);
      go(to);
    },
  }), [go]);
  if (path === '/admin/join') return <Join onDone={() => go('/admin')} />;
  if (down) return <ErrorPage title="The admin portal can't reach its server" text="Try again in a minute." action={<button className="btn solid" onClick={refresh}>Try again</button>} />;
  if (admin === undefined || setupOpen === undefined) return <div className="signin" />;
  if (!admin && setupOpen) return <Setup onDone={() => { setSetupOpen(false); refresh(); }} />;
  if (!admin) return <SignIn onDone={refresh} />;
  /** Runs an action that needs a second admin when there is more than one. True if it ran now. */
  const propose = async (action: string, payload: unknown) => {
    const r = await call('POST', '/propose', { action, payload });
    if (r.status !== 'done') kit.toast('Sent to another admin to approve');
    return r.status === 'done';
  };
  const known = PAGES.some(([p]) => p === path);
  const current = PAGES.find(([p]) => p === path)?.[1] ?? 'Menu';
  const page = !known ? <NotFound go={kit.go} />
    : path === '/admin/plans' ? <PlansPage admin={admin} />
    : path === '/admin/payments' ? <Payments admin={admin} />
    : path === '/admin/categories' ? <Categories admin={admin} />
    : path === '/admin/ads' ? <Ads admin={admin} propose={propose} />
    : path === '/admin/telegram' ? <TelegramPage admin={admin} />
    : path === '/admin/email' ? <EmailPage admin={admin} />
    : path === '/admin/users' ? <Users admin={admin} propose={propose} />
    : path === '/admin/access' ? <Access admin={admin} />
    : <Overview />;
  return (
    <KitCtx.Provider value={kit}>
      <div className={`adm${menu ? ' menu-open' : ''}`}>
        <aside>
          <div className="brand">
            <span className="row"><svg viewBox="-6 -14 132 126" width={34} height={32} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART.headChefRim! }} /><span className="display" style={{ fontSize: 20 }}>Zorion</span></span>
            <button type="button" className="menu-btn" aria-expanded={menu} aria-controls="admin-nav" onClick={() => setMenu(!menu)}>{menu ? 'Close' : current}<svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true"><path d={menu ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          </div>
          <nav id="admin-nav" aria-label="Admin">{PAGES.map(([to, label]) => <a key={to} href={to} aria-current={path === to ? 'page' : undefined} onClick={(e) => { e.preventDefault(); kit.go(to); }}>{label}</a>)}</nav>
          <div className="who"><strong style={{ overflowWrap: 'anywhere' }}>{admin.email}</strong><small>{admin.role === 'super' ? 'Full access' : 'Support'}</small>
            <button className="btn link light" onClick={() => call('POST', '/sign-out').then(refresh)}>Sign out</button></div>
        </aside>
        <main key={path}>{page}</main>
        {note && <div className="toast" role="status" key={note.n}>{note.text}</div>}
        {ask && <CodeWindow title={ask.title} action={ask.action} onClose={(ran) => { ask.done(ran); setAsk(null); }} />}
      </div>
    </KitCtx.Provider>
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
        {step === 'password' ? (
          <>
            <label>Email<input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label>Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          </>
        ) : <label>Code from your authenticator app<input className="input code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></label>}
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn solid" disabled={busy}>{busy ? 'Checking…' : step === 'password' ? 'Continue' : 'Sign in'}</button>
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

// ---------- shared pieces ----------
const Head = ({ title, children }: { title: string; children?: ReactNode }) => <header className="head"><h1>{title}</h1>{children && <div className="row">{children}</div>}</header>;
const Loading = ({ title, error }: { title: string; error: string | null }) => <><Head title={title} />{error ? <div className="err" role="alert">{error}</div> : <div className="sub">Loading…</div>}</>;
const Status = ({ kind, children }: { kind: 'ok' | 'off' | 'bad' | 'pink'; children: ReactNode }) => <span className={`state ${kind}`}>{children}</span>;
const KeyHint = ({ s }: { s: R }) => <strong>•••• {s.hint}{s.from === 'worker' ? <span className="sub" style={{ fontWeight: 500 }}> · set in Cloudflare</span> : null}</strong>;
const ago = (iso: string | null) => {
  if (!iso) return 'Never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return date(iso);
};
const stamp = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? 'Today' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

/** A field with its label, an optional hint, and the problem with it, right under it. */
function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactElement<R> }) {
  const id = useId();
  const note = error || hint ? `${id}-note` : undefined;
  return (
    <div className={`field${error ? ' bad' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-describedby': note, 'aria-invalid': error ? true : undefined })}
      {error ? <span className="ferr" id={note} role="alert">{error}</span> : hint ? <span className="hint" id={note}>{hint}</span> : null}
    </div>
  );
}

function Stepper({ value, min, max, label, zero, disabled, onChange }: { value: number; min: number; max: number; label: string; zero?: string; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <span className="stepper">
      <button type="button" aria-label={`Fewer, ${label}`} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="val" aria-live="polite">{value === 0 && zero ? zero : value}</span>
      <button type="button" aria-label={`More, ${label}`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </span>
  );
}

/** Money in S$: what you type stays as typed, and it tidies to two decimals when you leave the box. */
function Money({ id, value, unit, disabled, muted, onChange }: { id: string; value: string; unit: string; disabled?: boolean; muted?: boolean; onChange: (v: string) => void }) {
  const clean = (v: string) => { let t = v.replace(/[^\d.]/g, ''); const i = t.indexOf('.'); if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '').slice(0, 2); return t.slice(0, 8); };
  return (
    <span className={`money${disabled || muted ? ' off' : ''}`}>
      <span aria-hidden="true">S$</span>
      <input id={id} inputMode="decimal" autoComplete="off" placeholder="0.00" disabled={disabled} value={value} onChange={(e) => onChange(clean(e.target.value))} onBlur={() => { const n = parseFloat(value); if (!isNaN(n)) onChange(n.toFixed(2)); }} />
      <span aria-hidden="true">{unit}</span>
    </span>
  );
}

// Page-wide helpers: the code-at-action window, the "Saved" note and unsaved-change tracking.
interface Kit {
  /** Asks for an authenticator code when the button is pressed, then runs the action. Resolves true if it ran. */
  confirm: (title: string, action: (code: string) => Promise<unknown>) => Promise<boolean>;
  toast: (text: string) => void;
  setDirty: (dirty: boolean) => void;
  go: (to: string) => void;
}
const KitCtx = createContext<Kit>(null as unknown as Kit);
const useKit = () => useContext(KitCtx);

function CodeWindow({ title, action, onClose }: { title: string; action: (code: string) => Promise<unknown>; onClose: (ran: boolean) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(false); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [busy, onClose]);
  const submit = async (value = code) => {
    if (value.length !== 6) { setError('Enter all 6 digits.'); return; }
    setBusy(true); setError(null);
    try { await action(value); onClose(true); } catch (e) { setError((e as Error).message); setCode(''); input.current?.focus(); } finally { setBusy(false); }
  };
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(false); }}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="code-title" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2 id="code-title">{title}</h2>
        <Field label="Code from your authenticator app" error={error}>
          <input ref={input} className="input code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); setError(null); if (v.length === 6) submit(v); }} />
        </Field>
        <div className="row end"><button type="button" className="btn" disabled={busy} onClick={() => onClose(false)}>Cancel</button><button className="btn dark" disabled={busy}>{busy ? 'Checking…' : 'Confirm'}</button></div>
      </form>
    </div>
  );
}

/** Appears when something on the page has changed and isn't saved yet. */
function SaveBar({ dirty, busy, onSave, onDiscard }: { dirty: boolean; busy: boolean; onSave: () => void; onDiscard: () => void }) {
  const { setDirty } = useKit();
  useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty, setDirty]);
  if (!dirty) return null;
  return (
    <div className="savebar" role="region" aria-label="Unsaved changes">
      <strong>Unsaved changes</strong>
      <span className="row"><button type="button" className="btn ghost" disabled={busy} onClick={onDiscard}>Discard</button><button type="button" className="btn solid" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save'}</button></span>
    </div>
  );
}

/** A copy of server data the page can edit, with whether it has changed. */
function useDraft<T>(source: T | null | undefined): [T | null, (next: T) => void, boolean, () => void] {
  const [draft, setDraft] = useState<T | null>(null);
  useEffect(() => { if (source != null) setDraft(structuredClone(source)); }, [source]);
  const dirty = draft != null && source != null && JSON.stringify(draft) !== JSON.stringify(source);
  return [draft, setDraft, dirty, () => source != null && setDraft(structuredClone(source))];
}

/** Runs a button's action: busy while it works, the server's reason if it fails. */
function useRun(): [(fn: () => Promise<unknown>, done?: string) => Promise<boolean>, boolean, string | null, (e: string | null) => void] {
  const { toast } = useKit();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setError(null);
    try { await fn(); if (done) toast(done); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  };
  return [run, busy, error, setError];
}

// ---------- overview ----------
function Overview() {
  const { go } = useKit();
  const [d, , error] = useLoad<R>('/overview');
  const [pay] = useLoad<R>('/payments');
  const [tg] = useLoad<R>('/telegram');
  const [mail] = useLoad<R>('/email');
  if (!d) return <Loading title="Overview" error={error} />;
  const meetups = d.meetups as Record<string, number>;
  const live = Object.entries(meetups).filter(([k]) => k !== 'ended').reduce((s, [, n]) => s + n, 0);
  const mailFailing = mail?.last?.ok === false;
  const setup: Array<[string, 'ok' | 'off' | 'bad', string, string]> = [
    ['Payments', pay?.key?.set && pay?.webhook?.set ? 'ok' : 'off', pay?.key?.set && pay?.webhook?.set ? 'Ready' : 'Not connected', '/admin/payments'],
    ['Email', mailFailing ? 'bad' : mail?.key?.set ? 'ok' : 'off', mailFailing ? 'Last send failed' : mail?.key?.set ? 'Ready' : 'Not connected', '/admin/email'],
    ['Telegram', tg?.token?.set ? 'ok' : 'off', tg?.token?.set ? 'Ready' : 'Not connected', '/admin/telegram'],
  ];
  return (
    <>
      <Head title="Overview" />
      <div className="cards stats">
        <section><span className="sub">Hosts</span><span className="stat">{d.users.hosts}</span><span className="sub">{d.users.pro} on Pro · {d.users.suspended} suspended</span></section>
        <section><span className="sub">Meetups in progress</span><span className="stat">{live}</span><span className="sub">{meetups.confirmed ?? 0} confirmed · {meetups.ended ?? 0} ended</span></section>
        <section><span className="sub">Waiting for a second admin</span><span className="stat">{d.pendingApprovals}</span>{d.pendingApprovals > 0 && <a href="/admin/access" onClick={(e) => { e.preventDefault(); go('/admin/access'); }}>Review</a>}</section>
      </div>
      <div className="cards">
        <section>
          <h2>Setup</h2>
          {setup.map(([label, kind, text, to]) => <div className="line" key={label}><a href={to} onClick={(e) => { e.preventDefault(); go(to); }}><strong>{label}</strong></a><Status kind={kind}>{text}</Status></div>)}
        </section>
        <section><h2>Meetups by stage</h2>{[['draft', 'Draft'], ['date_vote', 'Date vote'], ['voting', 'Food vote'], ['places', 'Picking places'], ['place_vote', 'Place vote'], ['confirmed', 'Confirmed'], ['ended', 'Ended']].map(([k, l]) => <div className="line" key={k}><span>{l}</span><strong>{meetups[k!] ?? 0}</strong></div>)}</section>
      </div>
    </>
  );
}

// ---------- plans ----------
type PlanKey = 'free' | 'pro';
const ROWS: Array<[label: string, key: string, kind: 'fixed' | 'travel' | 'bool' | 'int']> = [
  ['Walking times', 'walk', 'fixed'], ['Cycling times', 'cycle', 'travel'], ['Transit times', 'transit', 'travel'],
  ['People per meetup', 'groupSize', 'int'], ['Meetups at a time', 'activeMeetups', 'int'],
  ['Own food options', 'ownCategories', 'bool'], ['Gold theme', 'goldTheme', 'bool'], ['Gold theme for guests', 'guestTheme', 'bool'], ['Ads', 'ads', 'bool'],
];
interface PlanDraft { free: R; pro: R; monthly: string; yearly: string; monthlyOn: boolean; yearlyOn: boolean }
const toDraft = (p: R): PlanDraft => ({ free: p.free, pro: p.pro, monthly: p.price.monthly ? (p.price.monthly / 100).toFixed(2) : '', yearly: p.price.yearly ? (p.price.yearly / 100).toFixed(2) : '', monthlyOn: p.price.monthly > 0, yearlyOn: p.price.yearly > 0 });

function PlansPage({ admin }: { admin: AdminUser }) {
  const { go } = useKit();
  const [d, reload, error] = useLoad<R>('/plans');
  const [cats] = useLoad<R>('/categories');
  const source = useMemo(() => (d ? toDraft(d.plans) : null), [d]);
  const [p, setP, dirty, discard] = useDraft<PlanDraft>(source);
  const [run, busy, err] = useRun();
  const [errors, setErrors] = useState<{ monthly?: string; yearly?: string }>({});
  const [tab, setTab] = useState<PlanKey>('pro');
  if (!d || !p) return <Loading title="Plans" error={error} />;
  const edit = admin.role === 'super';
  const set = (plan: PlanKey, key: string, v: unknown) => setP({ ...p, [plan]: { ...p[plan], [key]: v } });
  const cell = (plan: PlanKey, label: string, key: string, kind: string) => {
    const name = `${label}, ${plan === 'free' ? 'Free' : 'Pro'}`;
    if (kind === 'fixed') return <span className="sub" style={{ fontWeight: 600 }}>Always</span>;
    if (kind === 'travel') { const on = p[plan].travel.includes(key); return <Toggle on={on} label={name} disabled={!edit} onChange={(v) => set(plan, 'travel', v ? [...new Set([...p[plan].travel, key])] : p[plan].travel.filter((m: string) => m !== key))} />; }
    if (kind === 'bool') return <Toggle on={!!p[plan][key]} label={name} disabled={!edit} onChange={(v) => set(plan, key, v)} />;
    return key === 'groupSize'
      ? <Stepper value={p[plan][key]} min={2} max={200} label={name} disabled={!edit} onChange={(v) => set(plan, key, v)} />
      : <Stepper value={p[plan][key]} min={0} max={100} zero="No limit" label={name} disabled={!edit} onChange={(v) => set(plan, key, v)} />;
  };
  const m = parseFloat(p.monthly), y = parseFloat(p.yearly);
  const pct = p.monthlyOn && p.yearlyOn && m > 0 && y > 0 ? Math.round((1 - y / (m * 12)) * 100) : null;
  const compare = pct === null ? null : pct > 0 ? `Yearly is ${pct}% cheaper than 12 months of monthly.` : pct < 0 ? 'Yearly costs more than 12 months of monthly.' : 'Yearly costs the same as 12 months of monthly.';
  const transit = (p.free.travel.includes('transit') || p.pro.travel.includes('transit')) && cats && (cats.settings?.routing_provider ?? 'estimate') !== 'google';
  const save = () => {
    const next: typeof errors = {};
    if (p.monthlyOn && !(m >= 1)) next.monthly = 'Enter at least S$1, or switch off On sale.';
    if (p.yearlyOn && !(y >= 1)) next.yearly = 'Enter at least S$1, or switch off On sale.';
    setErrors(next);
    if (next.monthly || next.yearly) return;
    run(async () => {
      await call('PUT', '/plans', { free: p.free, pro: p.pro, price: { monthly: p.monthlyOn ? Math.round(m * 100) : 0, yearly: p.yearlyOn ? Math.round(y * 100) : 0 } });
      reload();
    }, 'Saved');
  };
  const price = (which: 'monthly' | 'yearly', label: string, unit: string) => {
    const on = p[`${which}On`];
    return (
      <div className="price">
        <div className="line flat"><label htmlFor={`price-${which}`}><strong>{label}</strong></label><span className="row"><span className="sub">{on ? 'On sale' : 'Not on sale'}</span><Toggle on={on} label={`Sell ${which}`} disabled={!edit} onChange={(v) => { setP({ ...p, [`${which}On`]: v }); setErrors({ ...errors, [which]: undefined }); }} /></span></div>
        <Money id={`price-${which}`} value={p[which]} unit={unit} muted={!on} disabled={!edit} onChange={(v) => { setP({ ...p, [which]: v, ...(v && !on ? { [`${which}On`]: true } : {}) }); setErrors({ ...errors, [which]: undefined }); }} />
        {errors[which] && <span className="ferr" role="alert">{errors[which]}</span>}
      </div>
    );
  };
  return (
    <>
      <Head title="Plans" />
      {!edit && <div className="note">Only super admins can change plans.</div>}
      <div className="cards plans">
        <section>
          <h2>Pro price</h2>
          {price('monthly', 'Monthly', '/ month')}
          {price('yearly', 'Yearly', '/ year')}
          {compare && <span className="sub">{compare}</span>}
        </section>
        <section>
          <h2>What each plan includes</h2>
          <div className="tabs phone-only" role="tablist" aria-label="Plan">{(['free', 'pro'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'free' ? 'Free' : 'Pro'}</button>)}</div>
          <div className="features" data-tab={tab}>
            <div className="frow head"><span /><span className="c-free">Free</span><span className="c-pro">Pro</span></div>
            {ROWS.map(([label, key, kind]) => <div className="frow" key={key}><span>{label}</span><span className="c-free">{cell('free', label, key, kind)}</span><span className="c-pro">{cell('pro', label, key, kind)}</span></div>)}
          </div>
          {transit && <div className="warn"><span>Transit times need Google routes, which are off.</span><a href="/admin/categories" onClick={(e) => { e.preventDefault(); go('/admin/categories'); }}>Turn on in Categories</a></div>}
        </section>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {edit && <SaveBar dirty={dirty} busy={busy} onSave={save} onDiscard={() => { discard(); setErrors({}); }} />}
    </>
  );
}

// ---------- connect pattern: Payments, Telegram, Email ----------
function Payments({ admin }: { admin: AdminUser }) {
  const { confirm, toast, go } = useKit();
  const [d, reload, error] = useLoad<R>('/payments');
  const [check, setCheck] = useState<R | null>(null);
  const [key, setKey] = useState('');
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [sure, setSure] = useState(false);
  const [run, busy, err] = useRun();
  const refresh = useCallback(() => call('POST', '/payments/check').then(setCheck).catch((e) => setCheck({ ok: false, message: e.message })), []);
  useEffect(() => { if (d?.key?.set) refresh(); }, [d?.key?.set, refresh]);
  if (!d) return <Loading title="Payments" error={error} />;
  const edit = admin.role === 'super';
  const connect = async () => {
    if (!key) { setKeyErr('Paste the secret key first.'); return; }
    if (await confirm('Connect Stripe', (code) => call('PUT', '/payments/key', { secretKey: key, code, connect: true }))) { setKey(''); setReplacing(false); toast('Stripe connected'); reload(); }
  };
  const keyForm = (
    <>
      <Field label="Secret key" hint="In Stripe: Developers, then API keys." error={keyErr}>
        <input className="input" type="password" autoComplete="off" placeholder="sk_live_…" value={key} onChange={(e) => { setKey(e.target.value.trim()); setKeyErr(null); }} />
      </Field>
      <div className="row"><button className="btn solid" onClick={connect}>Connect</button>{replacing && <button className="btn" onClick={() => { setReplacing(false); setKey(''); setKeyErr(null); }}>Cancel</button>}</div>
    </>
  );
  if (!d.key.set) return (
    <>
      <Head title="Payments" />
      {edit ? <section className="narrow"><h2>Connect Stripe</h2>{keyForm}</section> : <div className="note">Stripe isn't connected yet. A super admin can connect it.</div>}
    </>
  );
  const acct = check?.account;
  return (
    <>
      <Head title="Payments"><button className="btn" disabled={busy} onClick={() => run(refresh, 'Checked')}>Check now</button></Head>
      {check && check.ok === false && <div className="err" role="alert">{check.message}</div>}
      <div className="cards">
        <section>
          <h2>Stripe</h2>
          <div className="line"><span className="sub">Account</span><strong>{acct ? `${acct.name} · ${acct.country}` : '…'}</strong></div>
          <div className="line"><span className="sub">Mode</span>{d.mode === 'live' ? <Status kind="pink">Live</Status> : <Status kind="off">Test</Status>}</div>
          <div className="line"><span className="sub">Taking payments</span>{acct ? <Status kind={acct.charges ? 'ok' : 'bad'}>{acct.charges ? 'Yes' : 'Not yet'}</Status> : <span>…</span>}</div>
          <div className="line"><span className="sub">Webhook</span>{d.webhook.set && (!check?.ok || (check.webhook?.status === 'enabled' && check.webhook?.events))
            ? <Status kind="ok">Receiving</Status>
            : <span className="row"><Status kind="bad">Not connected</Status>{edit && <button className="btn" onClick={async () => { if (await confirm('Connect the Stripe webhook', (code) => call('POST', '/payments/webhook', { code }))) { toast('Webhook connected'); reload(); refresh(); } }}>Connect</button>}</span>}</div>
          <div className="line"><span className="sub">Last event</span><span>{ago(d.lastEventAt)}</span></div>
          <div className="line"><span className="sub">Active Pro subscriptions</span><strong>{d.subscriptions?.live ?? 0}</strong></div>
          <div className="line"><span className="sub">Prices</span><span>{d.prices.monthly || d.prices.yearly ? [d.prices.monthly && `S$${(d.prices.monthly / 100).toFixed(2)} a month`, d.prices.yearly && `S$${(d.prices.yearly / 100).toFixed(2)} a year`].filter(Boolean).join(' · ') : 'Not on sale'} <a href="/admin/plans" onClick={(e) => { e.preventDefault(); go('/admin/plans'); }}>Change</a></span></div>
        </section>
        {edit && <section>
          <h2>Key</h2>
          <div className="line"><span className="sub">Secret key</span><KeyHint s={d.key} /></div>
          {replacing ? keyForm : sure ? (
            <div className="confirm" role="alert"><span><strong>Disconnect Stripe?</strong> Nobody can buy Pro until you connect it again.</span>
              <div className="row"><button className="btn" onClick={() => setSure(false)}>Keep</button><button className="btn danger" onClick={async () => { if (await confirm('Disconnect Stripe', (code) => call('POST', '/payments/remove', { code }))) { setSure(false); setCheck(null); toast('Stripe disconnected'); reload(); } }}>Disconnect</button></div></div>
          ) : <div className="row"><button className="btn" onClick={() => setReplacing(true)}>Replace key</button><button className="btn danger" onClick={() => setSure(true)}>Disconnect</button></div>}
        </section>}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </>
  );
}

function TelegramPage({ admin }: { admin: AdminUser }) {
  const { confirm, toast } = useKit();
  const [d, reload, error] = useLoad<R>('/telegram');
  const [check, setCheck] = useState<R | null>(null);
  const [token, setToken] = useState('');
  const [tokenErr, setTokenErr] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [sure, setSure] = useState(false);
  const [run, busy] = useRun();
  const refresh = useCallback(() => call('POST', '/telegram/check').then(setCheck).catch((e) => setCheck({ ok: false, message: e.message })), []);
  useEffect(() => { if (d?.token?.set) refresh(); }, [d?.token?.set, refresh]);
  if (!d) return <Loading title="Telegram" error={error} />;
  const edit = admin.role === 'super';
  const connect = async () => {
    if (!token) { setTokenErr('Paste the bot token first.'); return; }
    if (await confirm('Connect the Telegram bot', (code) => call('PUT', '/telegram', { token, code }))) { setToken(''); setReplacing(false); toast('Bot connected'); reload(); }
  };
  const form = (
    <>
      <Field label="Bot token" hint="In Telegram, message @BotFather, send /newbot, and paste the token it gives you." error={tokenErr}>
        <input className="input" type="password" autoComplete="off" placeholder="123456789:AA…" value={token} onChange={(e) => { setToken(e.target.value.trim()); setTokenErr(null); }} />
      </Field>
      <div className="row"><button className="btn solid" onClick={connect}>Connect</button>{replacing && <button className="btn" onClick={() => { setReplacing(false); setToken(''); setTokenErr(null); }}>Cancel</button>}</div>
    </>
  );
  if (!d.token.set) return <><Head title="Telegram" />{edit ? <section className="narrow"><h2>Connect a bot</h2>{form}</section> : <div className="note">No bot yet. A super admin can connect one.</div>}</>;
  const hook = check?.webhook;
  return (
    <>
      <Head title="Telegram"><button className="btn" disabled={busy} onClick={() => run(refresh, 'Checked')}>Check now</button></Head>
      {check && check.ok === false && <div className="err" role="alert">{check.message}</div>}
      <div className="cards">
        <section>
          <h2>Bot</h2>
          <div className="line"><span className="sub">Name</span><strong>{d.username ? `@${d.username}` : '…'}</strong></div>
          <div className="line"><span className="sub">Receiving messages</span>{hook ? <Status kind={hook.connected ? 'ok' : 'bad'}>{hook.connected ? 'Yes' : 'No'}</Status> : <span>…</span>}</div>
          {hook && hook.pending > 0 && <div className="line"><span className="sub">Waiting messages</span><strong>{hook.pending}</strong></div>}
          {hook?.lastError && <div className="err">Telegram's last error: {hook.lastError}</div>}
        </section>
        {edit && <section>
          <h2>Token</h2>
          <div className="line"><span className="sub">Bot token</span><KeyHint s={d.token} /></div>
          {replacing ? form : sure ? (
            <div className="confirm" role="alert"><span><strong>Disconnect the bot?</strong> Nobody gets Telegram updates until you connect one again.</span>
              <div className="row"><button className="btn" onClick={() => setSure(false)}>Keep</button><button className="btn danger" onClick={async () => { if (await confirm('Disconnect the bot', (code) => call('POST', '/telegram/remove', { code }))) { setSure(false); setCheck(null); toast('Bot disconnected'); reload(); } }}>Disconnect</button></div></div>
          ) : <div className="row"><button className="btn" onClick={() => setReplacing(true)}>Replace token</button><button className="btn danger" onClick={() => setSure(true)}>Disconnect</button></div>}
        </section>}
      </div>
    </>
  );
}

interface EmailStatus { ok: boolean; at: string; from: string; key: 'portal' | 'worker' | 'none'; reason?: string }
/** Resend's reason, plus what to do about the common ones. */
function emailFix(reason = ''): string | null {
  if (/not verified|verify a domain|domain.*verif/i.test(reason)) return 'Verify the sender\'s domain in Resend (Domains), then send a test.';
  if (/api key is invalid|invalid api key|401|403/i.test(reason)) return 'Paste a new key from Resend (API Keys).';
  if (/no resend key/i.test(reason)) return 'Add the Resend key below.';
  return null;
}
function EmailPage({ admin }: { admin: AdminUser }) {
  const { confirm, toast } = useKit();
  const [d, reload, error] = useLoad<R>('/email');
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState('');
  const [from, setFrom] = useState<string | null>(null);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [run, busy, err] = useRun();
  if (!d) return <Loading title="Email" error={error} />;
  const edit = admin.role === 'super';
  const last = d.last as EmailStatus | null;
  const save = async () => {
    if (!d.key.set && !key) { setKeyErr('Paste the Resend key first.'); return; }
    if (await confirm(d.key.set ? 'Save email settings' : 'Connect Resend', (code) => call('PUT', '/email', { ...(key ? { apiKey: key } : {}), from: from ?? d.from, code }))) { setKey(''); setFrom(null); setEditing(false); toast('Saved'); reload(); }
  };
  const form = (
    <>
      <Field label="Resend API key" hint={d.key.set ? 'Leave empty to keep the current key.' : 'In Resend: API Keys, with sending access.'} error={keyErr}>
        <input className="input" type="password" autoComplete="off" placeholder={d.key.set ? `•••• ${d.key.hint}` : 're_…'} value={key} onChange={(e) => { setKey(e.target.value.trim()); setKeyErr(null); }} />
      </Field>
      <Field label="Sent from" hint="Must be on a domain verified in Resend."><input className="input" value={from ?? d.from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <div className="row"><button className="btn solid" onClick={save}>{d.key.set ? 'Save' : 'Connect'}</button>{d.key.set && <button className="btn" onClick={() => { setEditing(false); setKey(''); setFrom(null); setKeyErr(null); }}>Cancel</button>}</div>
    </>
  );
  if (!d.key.set && edit) return <><Head title="Email" /><section className="narrow"><h2>Connect Resend</h2>{form}</section></>;
  const fix = last && !last.ok ? emailFix(last.reason) : null;
  return (
    <>
      <Head title="Email" />
      <div className="cards">
        <section>
          <h2>Email</h2>
          <div className="line"><span className="sub">Resend key</span>{d.key.set ? <KeyHint s={d.key} /> : <Status kind="off">Not connected</Status>}</div>
          <div className="line"><span className="sub">Sent from</span><strong style={{ overflowWrap: 'anywhere', textAlign: 'right' }}>{d.from}</strong></div>
          <div className="line"><span className="sub">Last email</span>{last ? <span className="row"><Status kind={last.ok ? 'ok' : 'bad'}>{last.ok ? 'Sent' : 'Failed'}</Status><span>{stamp(last.at)}</span></span> : <span>None yet</span>}</div>
          {last && !last.ok && <div className="err" role="status" style={{ fontWeight: 500 }}><strong>{last.reason}</strong>{fix && <><br />{fix}</>}</div>}
          {edit && !editing && <div className="row"><button className="btn" disabled={busy} onClick={() => run(async () => { await call('POST', '/email/test'); reload(); }, 'Test email sent to you')}>Send me a test</button><button className="btn" onClick={() => setEditing(true)}>Edit</button></div>}
          {err && <div className="err" role="alert">{err}</div>}
        </section>
        {edit && editing && <section><h2>Edit email</h2>{form}</section>}
      </div>
    </>
  );
}

// ---------- categories ----------
interface Cat { key: string; name: string; icon: string; active: boolean; position: number; osm: string[]; google: { type?: string; text?: string } }
interface CatForm { key: string; name: string; icon: string; active: boolean; position: number; isNew: boolean; words: string; advanced: boolean; googleWords: string; mapWords: string; osm: string[]; googleType?: string }
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
const cuisines = (osm: string[]) => { const m = osm.join('').match(/\["cuisine"~"([^"]+)"\]/); return m ? m[1]!.split('|').map((w) => w.replace(/_/g, ' ')) : []; };
const wordList = (s: string) => s.toLowerCase().split(/[,|]/).map((w) => w.trim().replace(/[^a-z_ ]/g, '')).filter(Boolean);
const osmFor = (words: string[]) => [`["amenity"~"restaurant|fast_food|cafe|bar|pub"]["cuisine"~"${words.map((w) => w.replace(/ /g, '_')).join('|')}"]`];

/** The key for a map service, shown under the choice that needs it. */
function MapKey({ service, maps, routing, places, onChange }: { service: 'google' | 'ors'; maps: R; routing: string; places: string; onChange: () => void }) {
  const { confirm, toast } = useKit();
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [sure, setSure] = useState(false);
  const [run, busy, runErr] = useRun();
  const s = maps[service] as R;
  const status = (maps.status ?? {}) as R;
  const name = service === 'google' ? 'Google' : 'openrouteservice';
  const connect = async () => {
    if (!key) { setErr(`Paste the ${name} key first.`); return; }
    if (await confirm(`Connect ${name}`, (code) => call('PUT', `/maps/${service}`, { key, code }))) { setKey(''); setReplacing(false); toast(`${name} connected`); onChange(); }
  };
  const fallback = service === 'google'
    ? [places === 'google' && 'places come from OpenStreetMap', routing === 'google' && "trip times use Zorion's estimate"].filter(Boolean).join(' and ')
    : "trip times use Zorion's estimate";
  const form = (
    <>
      <Field label={`${name} key`} error={err} hint={service === 'google' ? 'In Google Cloud: turn on Places API (New), and Routes API for trip times, then create an API key.' : 'Free at openrouteservice.org, under API keys.'}>
        <input className="input" type="password" autoComplete="off" placeholder={service === 'google' ? 'AIza…' : 'Paste the key'} value={key} onChange={(e) => { setKey(e.target.value.trim()); setErr(null); }} />
      </Field>
      <div className="row"><button className="btn solid" onClick={connect}>Connect</button>{replacing && <button className="btn" onClick={() => { setReplacing(false); setKey(''); setErr(null); }}>Cancel</button>}</div>
    </>
  );
  if (!s?.set) return <div className="keybox">{form}<div className="warn"><span>Until a key is connected, {fallback}.</span></div></div>;
  const routesOff = service === 'google' && routing === 'google' && status.google && status.google.routes === false;
  const broken = service === 'google' ? status.google && !status.google.places : status.ors && !status.ors.ok;
  return (
    <div className="keybox">
      <div className="line flat"><span className="sub">{name} key</span><KeyHint s={s} /></div>
      {broken && <div className="err">{name} refused this key at the last check, so {fallback}.</div>}
      {routesOff && <div className="warn"><span>Routes API is off for this key, so trip times use Zorion's estimate. Turn it on in Google Cloud, then check again.</span><button className="btn" disabled={busy} onClick={() => run(async () => { const r = await call('POST', '/maps/check'); onChange(); if (r.error) throw new Error(r.error); }, 'Checked')}>Check again</button></div>}
      {runErr && <div className="err" role="alert">{runErr}</div>}
      {service === 'google' && maps.usage && <GoogleUsage usage={maps.usage} onChange={onChange} />}
      {replacing ? form : sure ? (
        <div className="confirm" role="alert"><span><strong>Remove the {name} key?</strong> Then {fallback}.</span>
          <div className="row"><button className="btn" onClick={() => setSure(false)}>Keep</button><button className="btn danger" onClick={async () => { if (await confirm(`Remove the ${name} key`, (code) => call('POST', `/maps/${service}/remove`, { code }))) { setSure(false); toast('Key removed'); onChange(); } }}>Remove</button></div></div>
      ) : <div className="row"><button className="btn" onClick={() => setReplacing(true)}>Replace key</button><button className="btn danger" onClick={() => setSure(true)}>Remove</button></div>}
    </div>
  );
}

const BUDGET_LABEL: Record<string, string> = { '50': 'At 50% of the free allowance', '75': 'At 75% of the free allowance', '90': 'At 90% of the free allowance', '100': 'When the free allowance is used up', paid: 'Never: keep using Google and pay' };
const FREE_FALLBACK: Record<string, string> = { places_text: 'place searches use OpenStreetMap', places_nearby: 'place searches use OpenStreetMap', lookup: 'starting places are looked up on OpenStreetMap', routes: "trip times use OpenStreetMap routing or Zorion's estimate" };
const until = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** This month's Google use against the free allowance, and when to switch to the free services. */
function GoogleUsage({ usage, onChange }: { usage: R; onChange: () => void }) {
  const [run, , err] = useRun();
  const services = usage.services as R[];
  const used = services.filter((s) => s.used > 0 || s.limit !== null);
  const over = services.filter((s) => s.limit !== null && s.used >= s.limit);
  return (
    <div className="usage">
      <div className="line flat"><strong>This month's Google use</strong><span className="sub">Resets {until(usage.resets)}</span></div>
      {used.map((s) => {
        const cap = s.limit ?? s.free;
        const pct = Math.min(100, Math.round((s.used / Math.max(cap, 1)) * 100));
        return (
          <div key={s.key} className="meter">
            <div className="line flat"><span>{s.label}</span><span className="sub">{s.used.toLocaleString('en-GB')} of {s.limit !== null ? s.limit.toLocaleString('en-GB') : `${s.free.toLocaleString('en-GB')} free`}</span></div>
            <div className="bar" role="progressbar" aria-label={s.label} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={s.used}><i style={{ width: `${pct}%` }} className={pct >= 100 ? 'full' : ''} /></div>
          </div>
        );
      })}
      {usage.pausedUntil && <div className="warn"><span>Google refused a request, so Zorion is using the free services until {new Date(usage.pausedUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.</span></div>}
      {over.length > 0 && <div className="warn"><span>Free allowance reached: {[...new Set(over.map((s) => FREE_FALLBACK[s.key]))].join(', ')} until {until(usage.resets)}.</span></div>}
      <Field label="Switch to the free services" hint={usage.budget === 'paid' ? 'Google bills you for use past the free allowance. Set a budget alert in Google Cloud.' : 'Counts Zorion\'s own calls. If other apps share your Google billing account, pick a lower share.'}>
        <select className="input" value={usage.budget} onChange={(e) => run(async () => { await call('PUT', '/settings', { google_budget: e.target.value }); onChange(); }, 'Saved')}>
          {Object.entries(BUDGET_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}

function Categories({ admin }: { admin: AdminUser }) {
  const [d, reload, error] = useLoad<R>('/categories');
  const [icons] = useLoad<{ icons: string[] }>('/icons');
  const [maps, reloadMaps] = useLoad<R>('/maps');
  const [form, setForm] = useState<CatForm | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const words = useMemo(() => (d ? ((d.settings.blocked_words ?? []) as string[]).join('\n') : null), [d]);
  const [blocked, setBlocked, blockedDirty, discardBlocked] = useDraft<string>(words);
  const [run, busy, err] = useRun();
  if (!d) return <Loading title="Categories" error={error} />;
  const edit = admin.role === 'super';
  const cats = d.categories as Cat[];
  const open = (c?: Cat) => {
    setSure(false); setNameErr(null);
    if (!c) { setForm({ key: '', name: '', icon: 'star', active: true, position: (cats.at(-1)?.position ?? 0) + 1, isNew: true, words: '', advanced: false, googleWords: '', mapWords: '', osm: [] }); return; }
    const map = cuisines(c.osm);
    const google = c.google?.text ?? '';
    const simple = !c.google?.type && (map.length === 0 ? true : google === '' || google.toLowerCase() === map[0]);
    setForm({ key: c.key, name: c.name, icon: c.icon, active: c.active, position: c.position, isNew: false, words: map.length ? map.join(', ') : google, advanced: !simple, googleWords: c.google?.type ?? google, mapWords: map.join(', '), osm: c.osm, googleType: c.google?.type });
  };
  const submit = () => form && (async () => {
    if (!form.name.trim()) { setNameErr('Enter a name.'); return; }
    const key = form.isNew ? slug(form.name) : form.key;
    if (key.length < 2) { setNameErr('Use letters or numbers in the name.'); return; }
    let osm = form.osm;
    let google: { type?: string; text?: string };
    if (form.advanced) {
      const map = wordList(form.mapWords);
      if (map.length) osm = osmFor(map);
      google = form.googleType && form.googleWords === form.googleType ? { type: form.googleType } : { text: (form.googleWords.trim() || form.name).slice(0, 60) };
    } else {
      const list = wordList(form.words);
      if (list.length) osm = osmFor(list);
      google = { text: (list[0] ?? form.name).slice(0, 60) };
    }
    if (await run(() => call('POST', '/categories', { key, name: form.name.trim(), icon: form.icon, active: form.active, position: form.position, osm, google }), 'Saved')) { setForm(null); reload(); }
  })();
  const toggle = (c: Cat, active: boolean) => run(async () => { await call('POST', '/categories', { ...c, active }); reload(); }, active ? `${c.name} shown` : `${c.name} hidden`);
  const setting = (body: R, done: string) => run(async () => { await call('PUT', '/settings', body); reload(); }, done);
  return (
    <>
      <Head title="Categories">{edit && <button className="btn solid" onClick={() => open()}>Add food option</button>}</Head>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="cards split">
        <section>
          <div className="frow cat head"><span>Food option</span><span>Shown</span><span /></div>
          {cats.map((c) => (
            <div className="frow cat" key={c.key}>
              <span className="row nowrap"><svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[c.icon] ?? ICONS.star! }} /><strong>{c.name}</strong></span>
              <span><Toggle on={c.active} label={`Show ${c.name}`} disabled={!edit} onChange={(v) => toggle(c, v)} /></span>
              <span style={{ justifySelf: 'end' }}>{edit && <button className="btn link" onClick={() => open(c)}>Edit</button>}</span>
            </div>
          ))}
        </section>
        {form ? (
          <section>
            <h2>{form.isNew ? 'New food option' : `Edit ${form.name || 'food option'}`}</h2>
            <Field label="Name" error={nameErr}><input className="input" maxLength={20} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setNameErr(null); }} /></Field>
            <div className="field"><span>Icon</span><div className="icons">{(icons?.icons ?? []).map((i) => <button key={i} type="button" aria-label={i} aria-pressed={form.icon === i} onClick={() => setForm({ ...form, icon: i })}><svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[i]! }} /></button>)}</div></div>
            {form.advanced ? (
              <>
                <Field label="Google search words" hint="What Google Places searches for."><input className="input" maxLength={60} placeholder={form.name || 'hotpot'} value={form.googleWords} onChange={(e) => setForm({ ...form, googleWords: e.target.value })} /></Field>
                <Field label="OpenStreetMap cuisine words" hint="Comma separated, as tagged on OpenStreetMap."><input className="input" placeholder="hotpot, steamboat" value={form.mapWords} onChange={(e) => setForm({ ...form, mapWords: e.target.value })} /></Field>
                <button type="button" className="btn link" onClick={() => setForm({ ...form, advanced: false, words: form.mapWords || form.googleWords })}>Use one set of search words</button>
              </>
            ) : (
              <>
                <Field label="Search words" hint="Comma separated. Used to find places on the map."><input className="input" placeholder="hotpot, steamboat" value={form.words} onChange={(e) => setForm({ ...form, words: e.target.value })} /></Field>
                <button type="button" className="btn link" onClick={() => setForm({ ...form, advanced: true, mapWords: form.mapWords || form.words, googleWords: form.googleWords || wordList(form.words)[0] || '' })}>Advanced</button>
              </>
            )}
            <div className="line"><span>Shown to hosts</span><Toggle on={form.active} label="Shown to hosts" onChange={(v) => setForm({ ...form, active: v })} /></div>
            <div className="line flat"><span className="row"><button className="btn solid" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button><button className="btn" onClick={() => setForm(null)}>Cancel</button></span>{!form.isNew && !sure && <button className="btn link danger" onClick={() => setSure(true)}>Remove</button>}</div>
            {sure && <div className="confirm" role="alert"><span><strong>Remove {form.name}?</strong> Meetups that already use it keep it.</span>
              <div className="row"><button className="btn" onClick={() => setSure(false)}>Keep</button><button className="btn danger" disabled={busy} onClick={async () => { if (await run(() => call('DELETE', `/categories/${form.key}`), `${form.name} removed`)) { setForm(null); reload(); } }}>Remove</button></div></div>}
          </section>
        ) : (
          <section>
            <h2>Search</h2>
            <Field label="Places come from"><select className="input" value={d.settings.places_provider} disabled={!edit} onChange={(e) => setting({ places_provider: e.target.value }, 'Saved')}><option value="osm">OpenStreetMap (free)</option><option value="google">Google Places</option></select></Field>
            <Field label="Trip times come from"><select className="input" value={d.settings.routing_provider ?? 'estimate'} disabled={!edit} onChange={(e) => setting({ routing_provider: e.target.value }, 'Saved')}><option value="estimate">Zorion's estimate</option><option value="osrm">OpenStreetMap routing (free)</option><option value="ors">openrouteservice</option><option value="google">Google routes</option></select></Field>
            {edit && maps && (d.settings.places_provider === 'google' || d.settings.routing_provider === 'google') && <MapKey service="google" maps={maps} places={d.settings.places_provider} routing={d.settings.routing_provider ?? 'estimate'} onChange={reloadMaps} />}
            {edit && maps && d.settings.routing_provider === 'ors' && <MapKey service="ors" maps={maps} places={d.settings.places_provider} routing="ors" onChange={reloadMaps} />}
            <Field label="Blocked words in names" hint="One per line. Hosts can't use these in meetup or food option names."><textarea className="input" rows={5} disabled={!edit} value={blocked ?? ''} onChange={(e) => setBlocked(e.target.value)} /></Field>
          </section>
        )}
      </div>
      {edit && <SaveBar dirty={blockedDirty} busy={busy} onDiscard={discardBlocked} onSave={() => setting({ blocked_words: (blocked ?? '').split('\n').map((w) => w.trim()).filter((w) => w.length > 1) }, 'Saved')} />}
    </>
  );
}

// ---------- ads ----------
function Ads({ admin, propose }: { admin: AdminUser; propose: (action: string, payload: unknown) => Promise<boolean> }) {
  const [d, reload, error] = useLoad<R>('/ads');
  const [cats] = useLoad<R>('/categories');
  const source = useMemo(() => (d ? { publisherId: d.adsense.publisherId ?? '', slot: d.adsense.slot ?? '', consent: d.adsense.consent !== false } : null), [d]);
  const [g, setG, gDirty, gDiscard] = useDraft(source);
  const [adding, setAdding] = useState(false);
  const blank = { name: '', categoryKey: '', url: '', startsOn: '', endsOn: '' };
  const [form, setForm] = useState(blank);
  const [errs, setErrs] = useState<R>({});
  const [run, busy, err] = useRun();
  if (!d || !g) return <Loading title="Ads" error={error} />;
  const edit = admin.role === 'super';
  const { toast } = useKit();
  const today = new Date().toISOString().slice(0, 10);
  const addSponsor = () => {
    const e: R = {};
    if (!form.name.trim()) e.name = 'Enter the sponsor\'s name.';
    if (form.url && !/^https:\/\//.test(form.url.trim())) e.url = 'Use a link starting with https://';
    if (!form.startsOn) e.startsOn = 'Pick a start date.';
    if (!form.endsOn) e.endsOn = 'Pick an end date.';
    else if (form.startsOn && form.endsOn < form.startsOn) e.endsOn = 'End after the start.';
    setErrs(e);
    if (Object.keys(e).length) return;
    run(async () => { if (await propose('ads.sponsor', { name: form.name.trim(), categoryKey: form.categoryKey || null, url: form.url.trim() || null, startsOn: form.startsOn, endsOn: form.endsOn })) toast('Sponsored spot added'); setForm(blank); setAdding(false); reload(); });
  };
  const catName = (k: string | null) => (k ? ((cats?.categories as Cat[] | undefined)?.find((c) => c.key === k)?.name ?? k) : 'Any');
  return (
    <>
      <Head title="Ads" />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="cards">
        <section>
          <h2>Google ads</h2>
          <Field label="Publisher ID"><input className="input" placeholder="ca-pub-…" disabled={!edit} value={g.publisherId} onChange={(e) => setG({ ...g, publisherId: e.target.value.trim() })} /></Field>
          <Field label="Ad unit ID" hint="Until this is set, ad spots show sponsored spots."><input className="input" inputMode="numeric" placeholder="1234567890" disabled={!edit} value={g.slot} onChange={(e) => setG({ ...g, slot: e.target.value.replace(/\D/g, '') })} /></Field>
          <div className="line"><span>Ask before showing Google ads</span><Toggle on={g.consent} label="Ask before showing Google ads" disabled={!edit} onChange={(consent) => setG({ ...g, consent })} /></div>
        </section>
        <section>
          <h2>Ad spots</h2>
          {(d.placements as R[]).map((p) => <div className="line" key={p.key}><span><strong>{p.label}</strong><br /><span className="sub">{p.kind === 'adsense' ? 'Google, then sponsored' : 'Sponsored'}</span></span><Toggle on={p.enabled} label={p.label} disabled={!edit} onChange={(enabled) => run(async () => { if (await propose('ads.placement', { key: p.key, enabled })) toast(enabled ? 'Ad spot on' : 'Ad spot off'); reload(); })} /></div>)}
        </section>
        <section>
          <div className="line flat"><h2>Sponsored spots</h2>{edit && !adding && <button className="btn" onClick={() => setAdding(true)}>Add</button>}</div>
          {(d.sponsors as R[]).length === 0 ? <span className="sub">None yet.</span> : (d.sponsors as R[]).map((s) => <div className="line" key={s.id}><span><strong>{s.name}</strong><br /><span className="sub">{catName(s.category_key)} · {date(s.starts_on)} to {date(s.ends_on)} · {s.views} views</span></span>{s.starts_on.slice(0, 10) <= today && s.ends_on.slice(0, 10) >= today ? <Status kind="pink">Live</Status> : null}</div>)}
          {adding && <>
            <Field label="Sponsor" error={errs.name}><input className="input" maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Shown with"><select className="input" value={form.categoryKey} onChange={(e) => setForm({ ...form, categoryKey: e.target.value })}><option value="">Any food option</option>{((cats?.categories as Cat[] | undefined) ?? []).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></Field>
            <Field label="Link (optional)" error={errs.url}><input className="input" type="url" placeholder="https://" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
            <div className="two"><Field label="Starts" error={errs.startsOn}><input className="input" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></Field><Field label="Ends" error={errs.endsOn}><input className="input" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></Field></div>
            <div className="row"><button className="btn solid" disabled={busy} onClick={addSponsor}>{busy ? 'Adding…' : 'Add'}</button><button className="btn" onClick={() => { setAdding(false); setForm(blank); setErrs({}); }}>Cancel</button></div>
          </>}
        </section>
      </div>
      {edit && <SaveBar dirty={gDirty} busy={busy} onDiscard={gDiscard} onSave={() => run(async () => { if (await propose('ads.adsense', g)) toast('Saved'); reload(); })} />}
    </>
  );
}

// ---------- users ----------
function Users({ admin, propose }: { admin: AdminUser; propose: (action: string, payload: unknown) => Promise<boolean> }) {
  const { toast } = useKit();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(typed.trim()), 300); return () => clearTimeout(t); }, [typed]);
  const [d, reload, error] = useLoad<R>(`/users?q=${encodeURIComponent(q)}&plan=${plan}`);
  const [sel, setSel] = useState<R | null>(null);
  const [sure, setSure] = useState<'suspend' | 'delete' | null>(null);
  useEffect(() => setSure(null), [sel]);
  const [run, busy, err] = useRun();
  const act = (action: string, payload: unknown, done: string) => run(async () => { if (await propose(action, payload)) toast(done); setSel(null); reload(); });
  const users = (d?.users as R[] | undefined) ?? null;
  return (
    <>
      <Head title="Users"><input className="input" style={{ width: 260 }} type="search" placeholder="Search by email" aria-label="Search hosts" value={typed} maxLength={80} onChange={(e) => setTyped(e.target.value)} /></Head>
      {(error || err) && <div className="err" role="alert">{error ?? err}</div>}
      <div className="cards split">
        <section>
          <div className="chips" role="group" aria-label="Show">{[['', 'All'], ['free', 'Free'], ['pro', 'Pro'], ['suspended', 'Suspended']].map(([v, l]) => <button key={v} type="button" aria-pressed={plan === v} onClick={() => setPlan(v!)}>{l}</button>)}</div>
          {users === null ? <span className="sub">Loading…</span> : users.length === 0 ? <span className="sub">{q || plan ? 'No hosts match.' : 'No hosts yet.'}</span> : users.map((u) => (
            <button type="button" key={u.id} className={`pick${sel?.id === u.id ? ' on' : ''}`} onClick={() => setSel(u)}>
              <span><strong>{u.email}</strong><br /><span className="sub">{u.meetups} meetups · joined {date(u.created_at)}</span></span>
              {u.status === 'suspended' ? <Status kind="bad">Suspended</Status> : u.plan === 'pro' ? <Status kind="pink">Pro</Status> : <Status kind="off">Free</Status>}
            </button>
          ))}
          {admin.role !== 'super' && <span className="sub">Emails are hidden for support admins.</span>}
        </section>
        {sel && <section>
          <h2 style={{ overflowWrap: 'anywhere' }}>{sel.email}</h2>
          <div className="line"><span className="sub">Plan</span><strong>{sel.plan === 'pro' ? 'Pro' : 'Free'}</strong></div>
          <div className="line"><span className="sub">Meetups hosted</span><strong>{sel.meetups}</strong></div>
          <div className="line"><span className="sub">Last sign-in</span><strong>{date(sel.last_sign_in_at)}</strong></div>
          <div className="line"><span className="sub">Two-step</span><strong>{sel.totp_enabled ? 'On' : 'Off'}</strong></div>
          {admin.role === 'super' && (sure ? (
            <div className="confirm" role="alert">
              <span>{sure === 'delete' ? <><strong>Delete this host?</strong> Their account and all their meetups go. This can't be undone.</> : sel.status === 'suspended' ? <><strong>Lift the suspension?</strong></> : <><strong>Suspend this host?</strong> They can't sign in until you lift it.</>}</span>
              <div className="row"><button className="btn" onClick={() => setSure(null)}>Keep</button>
                <button className="btn danger" disabled={busy} onClick={() => sure === 'delete' ? act('user.delete', { userId: sel.id }, 'Host deleted') : act('user.suspend', { userId: sel.id, suspend: sel.status !== 'suspended' }, sel.status === 'suspended' ? 'Suspension lifted' : 'Host suspended')}>{sure === 'delete' ? 'Delete' : sel.status === 'suspended' ? 'Lift' : 'Suspend'}</button></div>
            </div>
          ) : <div className="row"><button className="btn" onClick={() => setSure('suspend')}>{sel.status === 'suspended' ? 'Lift suspension' : 'Suspend'}</button><button className="btn danger" onClick={() => setSure('delete')}>Delete</button></div>)}
        </section>}
      </div>
    </>
  );
}

// ---------- admins and activity ----------
const PLACES: R = { osm: 'OpenStreetMap', google: 'Google Places' };
const ROUTES: R = { estimate: "Zorion's estimate", osrm: 'OpenStreetMap routing', ors: 'openrouteservice', google: 'Google routes' };
const money = (c: number) => `S$${(c / 100).toFixed(2)}`;
/** The log in plain words. */
function describe(l: R, admins: R[]): string {
  const detail = (l.detail ?? {}) as R;
  const who = (id: string) => admins.find((a) => a.id === id)?.email ?? 'an admin';
  const [base, outcome] = (() => { const m = String(l.action).match(/^(.*)\.(proposed|approved|rejected)$/); return m ? [m[1]!, m[2]!] : [String(l.action), '']; })();
  const what = (() => {
    switch (base) {
      case 'sign_in': return 'Signed in';
      case 'setup.first_admin': return 'Set up the first admin';
      case 'plans.save': { const p = detail.price as R | undefined; return p && (p.monthly || p.yearly) ? `Changed plans · Pro ${[p.monthly && `${money(p.monthly)} a month`, p.yearly && `${money(p.yearly)} a year`].filter(Boolean).join(', ')}` : 'Changed plans'; }
      case 'stripe.key': return `Connected a Stripe key (${detail.mode === 'live' ? 'live' : 'test'})`;
      case 'stripe.webhook': return 'Connected the Stripe webhook';
      case 'stripe.remove': return 'Disconnected Stripe';
      case 'telegram.connect': return `Connected the Telegram bot${l.target ? ` @${l.target}` : ''}`;
      case 'telegram.remove': return 'Disconnected the Telegram bot';
      case 'maps.google': return detail.routes ? 'Connected a Google key (places and routes)' : 'Connected a Google key (places)';
      case 'maps.ors': return 'Connected an openrouteservice key';
      case 'maps.google.remove': return 'Removed the Google key';
      case 'maps.ors.remove': return 'Removed the openrouteservice key';
      case 'email.save': return 'Changed email settings';
      case 'email.test': return 'Sent a test email';
      case 'category.save': return `Saved food option ${l.target}${detail.active === false ? ' (hidden)' : ''}`;
      case 'category.remove': return `Removed food option ${l.target}`;
      case 'setting.save':
        if (l.target === 'places_provider') return `Changed places to ${PLACES[detail.value] ?? detail.value}`;
        if (l.target === 'routing_provider') return `Changed trip times to ${ROUTES[detail.value] ?? detail.value}`;
        if (l.target === 'blocked_words') return 'Changed blocked words';
        if (l.target === 'google_budget') return detail.value === 'paid' ? 'Set Google to keep running past the free allowance' : detail.value === '100' ? 'Set Google to switch to free services when the free allowance is used up' : `Set Google to switch to free services at ${detail.value}% of the free allowance`;
        return 'Changed a setting';
      case 'admin.invite': return `Invited ${l.target} (${detail.role === 'super' ? 'full access' : 'support'})`;
      case 'admin.join': return 'Joined as an admin';
      case 'admin.on': return `Switched on ${who(l.target)}`;
      case 'admin.off': return `Switched off ${who(l.target)}`;
      case 'user.suspend': return detail.suspend === false ? 'Lift a host\'s suspension' : 'Suspend a host';
      case 'user.delete': return 'Delete a host\'s data';
      case 'ads.placement': return `Turn an ad spot ${detail.enabled ? 'on' : 'off'}`;
      case 'ads.sponsor': return `Add sponsored spot ${detail.name ?? ''}`.trim();
      case 'ads.adsense': return 'Change Google ads settings';
      default: return base.replace(/[._]/g, ' ');
    }
  })();
  if (outcome === 'proposed') return `Asked a second admin to ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
  if (outcome === 'approved') return `Approved: ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
  if (outcome === 'rejected') return `Turned down: ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
  // Direct (single-admin) runs of approval actions read in the past tense.
  return what.replace(/^Lift /, 'Lifted ').replace(/^Suspend /, 'Suspended ').replace(/^Delete /, 'Deleted ').replace(/^Turn /, 'Turned ').replace(/^Add /, 'Added ').replace(/^Change /, 'Changed ');
}

function Access({ admin }: { admin: AdminUser }) {
  const { confirm, toast } = useKit();
  const [d, reload, error] = useLoad<R>('/access');
  const [ap, reloadAp] = useLoad<R>('/approvals');
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState({ email: '', role: 'support' });
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [run, , err] = useRun();
  const admins = (d?.admins as R[] | undefined) ?? [];
  const pending = ((ap?.approvals as R[] | undefined) ?? []).filter((a) => a.status === 'pending');
  const sup = admin.role === 'super';
  const decide = (id: string, approve: boolean) => run(async () => { await call('POST', `/approvals/${id}`, { approve }); reload(); reloadAp(); }, approve ? 'Approved' : 'Turned down');
  const sendInvite = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invite.email.trim())) { setEmailErr('Enter an email address.'); return; }
    await confirm('Invite an admin', async (code) => { const r = await call('POST', '/admins/invite', { ...invite, email: invite.email.trim(), code }); setLink(r.link); });
  };
  if (!d) return <Loading title="Admins" error={error} />;
  return (
    <>
      <Head title="Admins" />
      {err && <div className="err" role="alert">{err}</div>}
      {pending.length > 0 && <section>
        <h2>Waiting for a second admin</h2>
        {pending.map((a) => <div className="line" key={a.id}><span><strong>{describe({ action: `${a.action}.proposed`, detail: a.payload }, admins).replace(/^Asked a second admin to /, '').replace(/^./, (c) => c.toUpperCase())}</strong><br /><span className="sub">Asked by {a.requested_by}</span></span>{a.requested_by_id === admin.id ? <span className="sub">Yours</span> : <span className="row"><button className="btn" onClick={() => decide(a.id, false)}>Turn down</button><button className="btn solid" onClick={() => decide(a.id, true)}>Approve</button></span>}</div>)}
      </section>}
      <div className="cards wide-right">
        <section>
          <div className="line flat"><h2>Admins</h2>{sup && !inviting && !link && <button className="btn" onClick={() => setInviting(true)}>Invite</button>}</div>
          {admins.map((a) => (
            <div className="line" key={a.id}>
              <span><strong style={{ overflowWrap: 'anywhere' }}>{a.email}</strong><br /><span className="sub">{a.role === 'super' ? 'Full access' : 'Support · can view, emails hidden'}{!a.active ? ' · switched off' : ''}</span></span>
              {a.id === admin.id ? <span className="sub">You</span> : sup && <button className="btn link" onClick={async () => { if (await confirm(a.active ? `Switch off ${a.email}` : `Switch on ${a.email}`, (code) => call('POST', `/admins/${a.id}/active`, { active: !a.active, code }))) { toast(a.active ? 'Switched off' : 'Switched on'); reload(); } }}>{a.active ? 'Switch off' : 'Switch on'}</button>}
            </div>
          ))}
          {inviting && !link && <>
            <Field label="Email" error={emailErr}><input className="input" type="email" value={invite.email} onChange={(e) => { setInvite({ ...invite, email: e.target.value }); setEmailErr(null); }} /></Field>
            <Field label="Access"><select className="input" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}><option value="support">Support · can view, emails hidden</option><option value="super">Full access</option></select></Field>
            <div className="row"><button className="btn solid" onClick={sendInvite}>Create invite link</button><button className="btn" onClick={() => { setInviting(false); setEmailErr(null); }}>Cancel</button></div>
          </>}
          {link && <div className="field"><span>Invite link for {invite.email}</span><span className="hint">Works once, for 24 hours. Send it to them yourself.</span><div className="row"><input className="input" readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: 1 }} /><button className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Copied'))}>Copy</button></div><button className="btn link" onClick={() => { setLink(null); setInviting(false); setInvite({ email: '', role: 'support' }); reload(); }}>Done</button></div>}
        </section>
        <section>
          <h2>Activity</h2>
          {((d.audit as R[] | undefined) ?? []).map((l) => <div className="log" key={l.id}><span className="sub">{stamp(l.created_at)}</span><span><strong>{describe(l, admins)}</strong><br /><span className="sub">{l.email ?? 'System'}</span></span></div>)}
        </section>
      </div>
    </>
  );
}
