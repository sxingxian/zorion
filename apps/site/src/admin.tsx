import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { ART } from '@zorion/core';

type R = Record<string, any>;
interface AdminUser { id: string; email: string; role: 'super' | 'support' }

async function call<T = any>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
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

const PAGES: Array<[path: string, label: string]> = [['/admin', 'Overview'], ['/admin/categories', 'Categories & rules'], ['/admin/ads', 'Sponsored & ads'], ['/admin/users', 'Users & plans'], ['/admin/access', 'Access & audit']];

export default function AdminApp({ path, go }: { path: string; go: (to: string) => void }) {
  const [admin, setAdmin] = useState<AdminUser | null | undefined>(undefined);
  const [idle, setIdle] = useState(30);
  const refresh = useCallback(() => call('GET', '/me').then((r) => { setAdmin(r.admin); setIdle(r.idleMinutes); }).catch(() => setAdmin(null)), []);
  useEffect(() => { refresh(); }, [refresh]);
  if (admin === undefined) return <div className="signin" />;
  if (!admin) return <SignIn onDone={refresh} />;
  const propose = async (action: string, payload: unknown) => {
    const r = await call('POST', '/propose', { action, payload });
    return r.status === 'done' ? 'Done.' : 'Sent for approval. A second admin has to approve it before it goes live.';
  };
  const page = path === '/admin/categories' ? <Categories admin={admin} /> : path === '/admin/ads' ? <Ads propose={propose} /> : path === '/admin/users' ? <Users propose={propose} /> : path === '/admin/access' ? <Access admin={admin} /> : <Overview />;
  return (
    <div className="adm">
      <aside>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg viewBox="-6 -14 132 126" width={38} height={36} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ART.headChefRim! }} />
          <span className="display" style={{ fontSize: 20 }}>Zorion</span><Pill kind="pro">Admin</Pill>
        </div>
        <nav aria-label="Admin">{PAGES.map(([to, label]) => <a key={to} href={to} aria-current={path === to ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(to); }}>{label}</a>)}</nav>
        <div className="who"><strong>{admin.email}</strong><small>{admin.role === 'super' ? 'Super admin' : 'Support admin'} · two-step on</small><small>Signs out after {idle} idle minutes</small>
          <button className="btn" style={{ marginTop: 8, color: '#fff', borderColor: '#33333b' }} onClick={() => call('POST', '/sign-out').then(refresh)}>Sign out</button></div>
      </aside>
      <main>{page}</main>
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
        <p className="sub">{step === 'password' ? 'Password first, then your authenticator. There is no email sign-in here.' : 'Enter the 6-digit code from your authenticator app.'}</p>
        {step === 'password' ? (
          <>
            <label>Email<input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label>Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          </>
        ) : <label>Authenticator code<input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></label>}
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn solid" disabled={busy}>{step === 'password' ? 'Continue' : 'Verify and sign in'}</button>
        <p className="sub">Five wrong tries pauses sign-in for 30 minutes. Every sign-in is logged.</p>
      </form>
    </div>
  );
}

const Head = ({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) => <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}><div><h1>{title}</h1><div className="sub">{sub}</div></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div></header>;

function Overview() {
  const [d, , error] = useLoad<R>('/overview');
  if (!d) return <><Head title="Overview" sub="Loading…" />{error && <div className="err">{error}</div>}</>;
  const meetups = d.meetups as Record<string, number>;
  const live = Object.entries(meetups).filter(([k]) => k !== 'ended').reduce((s, [, n]) => s + n, 0);
  return (
    <>
      <Head title="Overview" sub="Live numbers from the database" />
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
        <section><div className="sub">Hosts</div><div className="stat">{d.users.hosts}</div><div className="sub">{d.users.pro} on Pro · {d.users.suspended} suspended</div></section>
        <section><div className="sub">Meetups in progress</div><div className="stat">{live}</div><div className="sub">{meetups.confirmed ?? 0} confirmed · {meetups.ended ?? 0} ended</div></section>
        <section><div className="sub">Waiting for approval</div><div className="stat">{d.pendingApprovals}</div><div className="sub">Sensitive actions need a second admin</div></section>
        <section><div className="sub">Places come from</div><div className="stat" style={{ fontSize: 32 }}>{d.placesProvider === 'google' ? 'Google Places' : 'OpenStreetMap'}</div><div className="sub">Switch it under Categories &amp; rules</div></section>
      </div>
      <section><h2>By stage</h2>{['draft', 'date_vote', 'voting', 'places', 'place_vote', 'confirmed', 'ended'].map((k) => <div className="line" key={k}><span>{k.replace('_', ' ')}</span><strong>{meetups[k] ?? 0}</strong></div>)}</section>
    </>
  );
}

function Categories({ admin }: { admin: AdminUser }) {
  const [d, reload, error] = useLoad<R>('/categories');
  const [note, setNote] = useState<string | null>(null);
  const [words, setWords] = useState<string | null>(null);
  const canEdit = admin.role === 'super';
  if (!d) return <><Head title="Categories & rules" sub="Loading…" />{error && <div className="err">{error}</div>}</>;
  const s = d.settings as R;
  const save = (body: R) => call('PUT', '/settings', body).then(() => { setNote('Saved.'); reload(); }).catch((e) => setNote(e.message));
  const saveCat = (c: R, change: R) => call('POST', '/categories', { key: c.key, name: c.name, icon: c.icon, active: c.active, position: c.position, osm: c.osm, google: c.google, ...change }).then(reload).catch((e) => setNote(e.message));
  return (
    <>
      <Head title="Categories & rules" sub="What hosts can put on the ballot, and how places are found" />
      {note && <div className="info" role="status">{note}</div>}
      {!canEdit && <div className="info">Support admins can read this page. Only a super admin can change it.</div>}
      <div className="cards">
        <section>
          <h2>Built-in categories</h2>
          <table><thead><tr><th>Category</th><th>Places search</th><th>Active</th></tr></thead>
            <tbody>{(d.categories as R[]).map((c) => <tr key={c.key}><td><strong>{c.name}</strong></td><td className="sub">{c.google?.type ?? c.google?.text ?? '—'}</td><td><Toggle on={c.active} label={`${c.name} active`} disabled={!canEdit} onChange={(active) => saveCat(c, { active })} /></td></tr>)}</tbody></table>
          <div className="info">Fallback when a search finds nothing: the host picks the next category on the ballot.</div>
        </section>
        <section>
          <h2>Rules</h2>
          <div className="line"><span>Places come from</span><select className="input" style={{ width: 200 }} aria-label="Places come from" value={s.places_provider} disabled={!canEdit} onChange={(e) => save({ places_provider: e.target.value })}><option value="osm">OpenStreetMap (free)</option><option value="google">Google Places (needs a key)</option></select></div>
          <div className="line"><span>Trip times come from</span><select className="input" style={{ width: 200 }} aria-label="Trip times come from" value={s.routing_provider ?? 'estimate'} disabled={!canEdit} onChange={(e) => save({ routing_provider: e.target.value })}><option value="estimate">Zorion's estimate</option><option value="google">Google routes (needs a key)</option></select></div>
          <div className="info">The estimate keeps every starting point inside Zorion. Google routes gives real walking, cycling and transit times, and for that each starting point is sent to Google with no name attached. Say so in your privacy policy before switching it on.</div>
          <div className="line"><span>Let Pro hosts add their own categories</span><Toggle on={s.own_categories !== false} label="Own categories" disabled={!canEdit} onChange={(v) => save({ own_categories: v })} /></div>
          <div className="line"><span>Group size, Free</span><input className="input" style={{ width: 90 }} type="number" min={2} max={100} defaultValue={s.group_size?.free ?? 8} disabled={!canEdit} onBlur={(e) => save({ group_size: { free: Number(e.target.value), pro: s.group_size?.pro ?? 30 } })} /></div>
          <div className="line"><span>Group size, Pro</span><input className="input" style={{ width: 90 }} type="number" min={2} max={200} defaultValue={s.group_size?.pro ?? 30} disabled={!canEdit} onBlur={(e) => save({ group_size: { free: s.group_size?.free ?? 8, pro: Number(e.target.value) } })} /></div>
          <label>Blocked words in names, one per line<textarea className="input" style={{ minHeight: 110, padding: 12 }} disabled={!canEdit} value={words ?? (s.blocked_words ?? []).join('\n')} onChange={(e) => setWords(e.target.value)} /></label>
          <button className="btn" disabled={!canEdit || words === null} onClick={() => save({ blocked_words: (words ?? '').split('\n').map((w) => w.trim()).filter((w) => w.length > 1) })}>Save blocked words</button>
          <div className="info">Voting rules are fixed in code: ballot up to 6, guest votes half rounded up, 5 to 8 places shown, shortlist 1 or up to half. Own categories: Pro only, 12 characters, an icon from the fixed set of {d.icons.length}, no uploads.</div>
        </section>
      </div>
    </>
  );
}

function Ads({ propose }: { propose: (action: string, payload: unknown) => Promise<string> }) {
  const [d, reload, error] = useLoad<R>('/ads');
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', categoryKey: '', url: '', startsOn: '', endsOn: '' });
  const [pub, setPub] = useState<string | null>(null);
  if (!d) return <><Head title="Sponsored & ads" sub="Loading…" />{error && <div className="err">{error}</div>}</>;
  const act = (action: string, payload: unknown) => propose(action, payload).then((m) => { setNote(m); reload(); }).catch((e) => setNote(e.message));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <Head title="Sponsored & ads" sub="Free-tier ad slots in the app and on the landing page" />
      {note && <div className="info" role="status">{note}</div>}
      <div className="cards">
        <section>
          <h2>Placements</h2>
          <table><thead><tr><th>Placement</th><th>Type</th><th>On</th></tr></thead>
            <tbody>{(d.placements as R[]).map((p) => <tr key={p.key}><td><strong>{p.label}</strong></td><td><Pill kind={p.kind === 'adsense' ? 'dark' : ''}>{p.kind === 'adsense' ? 'Google AdSense' : 'Sponsored'}</Pill></td><td><Toggle on={p.enabled} label={p.label} onChange={(enabled) => act('ads.placement', { key: p.key, enabled })} /></td></tr>)}</tbody></table>
        </section>
        <section>
          <h2>Sponsored slots</h2>
          <table><thead><tr><th>Sponsor</th><th>Category</th><th>Runs</th><th>Views</th></tr></thead>
            <tbody>{(d.sponsors as R[]).length === 0 ? <tr><td colSpan={4} className="sub">No sponsors yet.</td></tr> : (d.sponsors as R[]).map((s) => <tr key={s.id}><td><strong>{s.name}</strong></td><td>{s.category_key ?? 'Any'}</td><td>{date(s.starts_on)} to {date(s.ends_on)} {s.starts_on.slice(0, 10) <= today && s.ends_on.slice(0, 10) >= today ? <Pill kind="live">Live</Pill> : null}</td><td>{s.views}</td></tr>)}</tbody></table>
          <h2>New sponsored slot</h2>
          <label>Sponsor name<input className="input" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Category key, or leave empty for any<input className="input" value={form.categoryKey} onChange={(e) => setForm({ ...form, categoryKey: e.target.value })} /></label>
          <label>Link (https only), optional<input className="input" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><label>Starts<input className="input" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></label><label>Ends<input className="input" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></label></div>
          <button className="btn solid" disabled={!form.name.trim() || !form.startsOn || !form.endsOn} onClick={() => act('ads.sponsor', { name: form.name, categoryKey: form.categoryKey.trim() || null, url: form.url.trim() || null, startsOn: form.startsOn, endsOn: form.endsOn })}>Propose this slot</button>
        </section>
        <section>
          <h2>Who sees ads</h2>
          <div className="info">Pro hosts never see ads. Guests see ads in both themes, unless they sign in and are Pro themselves. A sponsored place is always labelled and never changes the fair-middle ranking. AdSense runs on the landing page only; in-app slots are first-party, so no ad network sees guest locations.</div>
        </section>
        <section>
          <h2>Google AdSense</h2>
          <label>Publisher ID<input className="input" placeholder="ca-pub-…" value={pub ?? d.adsense.publisherId ?? ''} onChange={(e) => setPub(e.target.value)} /></label>
          <div className="line"><span>Ask for consent before loading ads</span><Toggle on={d.adsense.consent !== false} label="Consent before ads" onChange={(consent) => act('ads.adsense', { publisherId: pub ?? d.adsense.publisherId ?? '', consent })} /></div>
          <button className="btn" disabled={pub === null} onClick={() => act('ads.adsense', { publisherId: pub ?? '', consent: d.adsense.consent !== false })}>Save publisher ID</button>
          <div className="info">Changes on this page are written to the audit log and need a second admin to go live.</div>
        </section>
      </div>
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
      <Head title="Users & plans" sub="Hosts only. Guests have no account and are never listed here."><input className="input" style={{ width: 260 }} placeholder="Search by email" aria-label="Search hosts" value={typed} maxLength={80} onChange={(e) => setTyped(e.target.value)} /></Head>
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
          {!sel ? <div className="info">Select a host to see their plan and the actions you can take.</div> : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><h2 style={{ overflowWrap: 'anywhere' }}>{sel.email}</h2><Pill kind={sel.plan === 'pro' ? 'pro' : ''}>{sel.plan === 'pro' ? 'Pro' : 'Free'}</Pill></div>
              <div><div className="line"><span className="sub">Plan</span><strong>{sel.plan === 'pro' ? 'Pro, billed by Stripe' : 'Free'}</strong></div><div className="line"><span className="sub">Meetups hosted</span><strong>{sel.meetups}</strong></div><div className="line"><span className="sub">Last sign-in</span><strong>{date(sel.last_sign_in_at)}</strong></div><div className="line"><span className="sub">Two-step</span><strong>{sel.totp_enabled ? 'On' : 'Off'}</strong></div></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button className="btn" onClick={() => act('user.suspend', { userId: sel.id, suspend: sel.status !== 'suspended' })}>{sel.status === 'suspended' ? 'Lift suspension' : 'Suspend account'}</button>
                {sure
                  ? <><button className="btn solid" onClick={() => act('user.delete', { userId: sel.id })}>Yes, delete everything</button><button className="btn" onClick={() => setSure(false)}>Keep</button></>
                  : <button className="btn" onClick={() => setSure(true)}>Delete data</button>}
              </div>
              {sure && <div className="err" role="alert">This removes the host and all their meetups. It cannot be undone.</div>}
              <div className="info">Payments and cards live in Stripe and never reach Zorion. Suspending or deleting needs a second admin, and every action here is written to the audit log.</div>
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
  const [note, setNote] = useState<string | null>(null);
  const decide = (id: string, approve: boolean) => call('POST', `/approvals/${id}`, { approve }).then(() => { reloadAp(); reload(); }).catch((e) => setNote(e.message));
  return (
    <>
      <Head title="Access & audit" sub="Who can sign in here, what is waiting, and everything that was done" />
      {(note || error) && <div className="err">{note ?? error}</div>}
      <div className="cards">
        <section>
          <h2>Waiting for a second admin</h2>
          {(ap?.approvals as R[] | undefined)?.filter((a) => a.status === 'pending').length ? (ap!.approvals as R[]).filter((a) => a.status === 'pending').map((a) => (
            <div className="line" key={a.id}><span><strong>{a.action}</strong><br /><span className="sub">{a.requested_by} · {JSON.stringify(a.payload)}</span></span>{a.requested_by_id === admin.id ? <Pill>Yours</Pill> : <span style={{ display: 'flex', gap: 6 }}><button className="btn" onClick={() => decide(a.id, false)}>Reject</button><button className="btn solid" onClick={() => decide(a.id, true)}>Approve</button></span>}</div>
          )) : <div className="info">Nothing is waiting.</div>}
          <h2>Admins</h2>
          <table><thead><tr><th>Admin</th><th>Role</th><th>Two-step</th></tr></thead><tbody>{(d?.admins as R[] | undefined)?.map((a) => <tr key={a.id}><td><strong>{a.email}</strong>{!a.active && <> <Pill kind="dark">Off</Pill></>}</td><td>{a.role === 'super' ? 'Super admin' : 'Support'}</td><td><Pill>{a.totp_enabled ? 'On' : 'Off'}</Pill></td></tr>)}</tbody></table>
          <div className="info">Admins are created from the command line, never from this page: <code>npm run create-admin</code> in <code>apps/site</code>.</div>
        </section>
        <section>
          <h2>Audit log</h2>
          <table><thead><tr><th>When</th><th>Who</th><th>Action</th></tr></thead>
            <tbody>{(d?.audit as R[] | undefined)?.map((l) => <tr key={l.id}><td className="sub">{new Date(l.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>{l.email ?? '—'}</td><td><strong>{l.action}</strong>{l.target ? ` · ${l.target}` : ''}</td></tr>)}</tbody></table>
        </section>
      </div>
    </>
  );
}
