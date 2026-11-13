import { useEffect, useState } from 'react';
import { LIMITS } from '@zorion/core';
import { type Me, type ModeChoice, api, navigate, useAction, useSession } from './lib';
import { Btn, Check, Chip, Codes, Facts, Field, Header, Mascot, Note, Oops, Seg, Switch, Toast } from './ui';
import { TelegramLink } from './updates';

/** The sign-in key as a QR code. Drawn on this device, so the key is never sent to an image service. */
function QrCode({ text }: { text: string }) {
  const [cells, setCells] = useState<{ n: number; d: string } | null>(null);
  useEffect(() => {
    let live = true;
    import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      if (live) setCells({ n, d });
    });
    return () => { live = false; };
  }, [text]);
  if (!cells) return <div style={{ width: 196, height: 196, margin: '0 auto' }} />;
  return (
    <svg viewBox={`-4 -4 ${cells.n + 8} ${cells.n + 8}`} width={196} height={196} role="img" aria-label="QR code for your authenticator app" shapeRendering="crispEdges" style={{ margin: '0 auto', borderRadius: 16, background: '#fff', flex: 'none' }}>
      <path d={cells.d} fill="#0b0b0d" />
    </svg>
  );
}

export function Account({ me, modeChoice, setMode }: { me: Me; modeChoice: ModeChoice; setMode: (m: ModeChoice) => void }) {
  const { refresh } = useSession();
  const [run, busy, error, clear] = useAction();
  const [view, setView] = useState<'main' | 'password' | 'two_step' | 'delete'>('main');
  const [name, setName] = useState(me.display_name);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [tgLink, setTgLink] = useState<string | null>(null);
  // While a Telegram link is open, check again when the host comes back from Telegram.
  useEffect(() => {
    if (!tgLink) return;
    const back = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', back);
    const t = setInterval(back, 5000);
    return () => { document.removeEventListener('visibilitychange', back); clearInterval(t); };
  }, [tgLink, refresh]);
  useEffect(() => { if (me.telegram) setTgLink(null); }, [me.telegram]);
  const pro = me.plan === 'pro';
  const go = (v: typeof view) => { clear(); setCode(''); setView(v); };
  const patch = (body: unknown) => run(async () => { await api('PATCH', '/account', body); await refresh(); });

  if (view === 'password') {
    return (
      <>
        <Header title={me.has_password ? 'Change password' : 'Set a password'} sub={me.email} onBack={() => go('main')} />
        <main className="screen" style={{ gap: 14 }}>
          {me.has_password && <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={setCurrent} />}
          <Field label="New password" type="password" autoComplete="new-password" value={next} onChange={setNext} />
          <p className="small">At least 10 characters. Changing it signs you out everywhere else.</p>
          <Oops>{error}</Oops>
          <Btn className="push" busy={busy} disabled={next.length < 10} onClick={async () => (await run(async () => { await api('POST', '/account/password', { current, next }); await refresh(); })) && (setToast('Password saved'), setCurrent(''), setNext(''), go('main'))}>Save password</Btn>
        </main>
      </>
    );
  }
  if (view === 'two_step') {
    if (recovery) {
      return (
        <>
          <Header title="Recovery codes" sub="Shown once" />
          <main className="screen" style={{ gap: 14 }}>
            <Note ok>Two-step verification is on.</Note>
            <p className="small" style={{ fontSize: 14 }}>Keep these somewhere safe. Each one signs you in once if you lose your authenticator.</p>
            <div className="card grid2" style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700 }}>{recovery.map((r) => <span key={r}>{r}</span>)}</div>
            <Btn className="push" onClick={() => { setRecovery(null); setSetup(null); go('main'); }}>I have saved them</Btn>
          </main>
        </>
      );
    }
    if (me.totp_enabled) {
      return (
        <>
          <Header title="Two-step verification" sub="On" onBack={() => go('main')} />
          <main className="screen" style={{ gap: 14 }}>
            <Note ok>Signing in asks for a second, different proof.</Note>
            <h2 className="display h1">Turn it off</h2>
            <p className="small" style={{ fontSize: 14 }}>Enter a code from your authenticator app to confirm.</p>
            <Codes length={6} value={code} onChange={setCode} label="Authenticator code" />
            <Oops>{error}</Oops>
            <Btn className="push" kind="second" busy={busy} disabled={code.length !== 6} onClick={async () => (await run(async () => { await api('POST', '/account/two-step/disable', { code }); await refresh(); })) && go('main')}>Turn off two-step verification</Btn>
          </main>
        </>
      );
    }
    return (
      <>
        <Header title="Two-step verification" sub="Off" onBack={() => go('main')} />
        <main className="screen" style={{ gap: 14 }}>
          <Note>Two-step verification pairs your authenticator with a second, different proof: your emailed code or your password.</Note>
          {!setup ? (
            <>
              <p className="small" style={{ fontSize: 14 }}>You will need an authenticator app. After this, signing in always asks for two different proofs.</p>
              <Oops>{error}</Oops>
              <Btn className="push" busy={busy} onClick={() => run(async () => setSetup(await api('POST', '/account/two-step/setup')))}>Set up an authenticator</Btn>
            </>
          ) : (
            <>
              <h2 className="display h1">Add Zorion to your app</h2>
              <QrCode text={setup.uri} />
              <p className="small center">Scan this with your authenticator app, or use the button on this phone.</p>
              <a className="btn second" href={setup.uri}>Open my authenticator app</a>
              <Facts rows={[['Key', <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{setup.secret}</span>]]} />
              <p className="small">Or type the key into the app by hand. Then enter the 6-digit code it shows.</p>
              <Codes length={6} value={code} onChange={setCode} label="Authenticator code" />
              <Oops>{error}</Oops>
              <Btn className="push" busy={busy} disabled={code.length !== 6} onClick={() => run(async () => { const r = await api('POST', '/account/two-step/enable', { code }); await refresh(); setRecovery(r.recovery); })}>Turn on two-step verification</Btn>
            </>
          )}
        </main>
      </>
    );
  }
  if (view === 'delete') {
    return (
      <>
        <Header title="Delete account" sub={me.email} onBack={() => go('main')} />
        <main className="screen" style={{ gap: 14 }}>
          <Note>This deletes your account, your meetups and every guest's votes and replies for them. It cannot be undone.</Note>
          <Field label="Type your email to confirm" type="email" value={confirm} onChange={setConfirm} />
          <Oops>{error}</Oops>
          <Btn className="push" kind="second" busy={busy} disabled={confirm.trim().toLowerCase() !== me.email} onClick={async () => (await run(async () => { await api('POST', '/account/delete', { email: confirm }); await refresh(); })) && navigate('/', true)}>Delete everything</Btn>
        </main>
      </>
    );
  }
  return (
    <>
      <Header title="Account" sub={me.email} back="/" right={pro ? <Chip kind="pro">Pro</Chip> : undefined} />
      <main className="screen" style={{ gap: 12 }}>
        <div className="stack">
          <span className="label">Theme</span>
          <Seg value={pro ? me.theme : 'pink'} onChange={(theme) => patch({ theme })} options={pro ? [{ value: 'gold', label: 'Gold' }, { value: 'pink', label: 'Pink' }] : [{ value: 'pink', label: 'Pink' }, { value: 'gold', label: 'Gold', locked: true }]} />
          <span className="label" style={{ marginTop: 4 }}>Appearance</span>
          <Seg value={modeChoice} onChange={setMode} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: 'Match device' }]} />
          <p className="small">{pro ? 'Pro can use gold or pink. There are no ads in either.' : 'Light and dark work on every plan. Gold comes with Pro.'}</p>
        </div>
        <div className="card row between" style={{ padding: '12px 14px' }}>
          <div className="stack" style={{ gap: 0 }}><strong style={{ fontWeight: 800 }}>{pro ? 'Pro plan' : 'Free plan'}</strong><span className="small">{pro ? 'No ads. Your own categories and themes.' : 'Ads on. Walking routes.'}</span></div>
          {pro ? <button className="btn" style={{ width: 'auto', minHeight: 44, fontSize: 14, background: 'var(--sel)', color: 'var(--sel-text)' }} disabled={busy} onClick={() => run(async () => { location.href = (await api('POST', '/billing/portal')).url; })}>Manage</button> : <a className="btn" style={{ width: 'auto', minHeight: 44, fontSize: 14, background: 'var(--sel)', color: 'var(--sel-text)' }} href="/pro" onClick={(e) => { e.preventDefault(); navigate('/pro'); }}>Go Pro</a>}
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}><div className="grow"><Field label="Your name on meetups" value={name} max={LIMITS.inviteeName} onChange={setName} /></div><button className="btn second" style={{ width: 'auto', minHeight: 52 }} disabled={busy || !name.trim() || name.trim() === me.display_name} onClick={async () => (await patch({ displayName: name })) && setToast('Name saved')}>Save</button></div>
        <Oops>{error}</Oops>
        <Switch on={me.notify} title="Email me about my meetups" meta="When a vote is complete, or a guest changes their reply after the plan is set." onChange={(notify) => run(async () => { await api('PATCH', '/account', { notify }); await refresh(); })} />
        {me.telegram_ready && (tgLink && !me.telegram
          ? <TelegramLink url={tgLink} onCancel={() => setTgLink(null)} />
          : (
            <div className="switch" style={{ cursor: 'default' }}>
              <span className="grow stack" style={{ gap: 0 }}><strong style={{ fontWeight: 800 }}>Telegram</strong><span className="small">{me.telegram ? 'Connected. The same news comes there too.' : 'Get the same news on Telegram.'}</span></span>
              {me.telegram
                ? <button type="button" className="btn second" style={{ width: 'auto', minHeight: 44, fontSize: 14 }} disabled={busy} onClick={() => run(async () => { await api('POST', '/account/telegram/stop', {}); await refresh(); })}>Disconnect</button>
                : <button type="button" className="btn second" style={{ width: 'auto', minHeight: 44, fontSize: 14 }} disabled={busy} onClick={() => run(async () => setTgLink((await api('POST', '/account/telegram', {})).url))}>Connect</button>}
            </div>
          ))}
        <div className="card" style={{ padding: '0 14px' }}>
          <button className="person" style={{ minHeight: 48 }} onClick={() => go('password')}><span className="grow" style={{ fontWeight: 700 }}>Password</span><span className="small">{me.has_password ? 'Set' : 'Not set'}</span></button>
          <button className="person" style={{ minHeight: 48 }} onClick={() => go('two_step')}><span className="grow" style={{ fontWeight: 700 }}>Two-step verification</span><span className="small">{me.totp_enabled ? 'Authenticator on' : 'Off'}</span></button>
          <a className="person" style={{ minHeight: 48 }} href="/api/account/export" download="zorion-data.json"><span className="grow" style={{ fontWeight: 700 }}>Your data</span><span className="small">Export</span></a>
          <button className="person" style={{ minHeight: 48 }} onClick={() => go('delete')}><span className="grow" style={{ fontWeight: 700 }}>Delete account</span></button>
          <button className="person" style={{ minHeight: 48 }} onClick={() => run(async () => { await api('POST', '/auth/sign-out'); await refresh(); navigate('/', true); })}><span className="grow" style={{ fontWeight: 700 }}>Sign out</span></button>
        </div>
        <Toast text={toast} onDone={() => setToast(null)} />
      </main>
    </>
  );
}

const BENEFITS = ['No ads or sponsored spots', 'Larger groups', 'Transit and cycling routes', 'Your own categories, with an icon', 'Pink or gold look for you and your guests'];

export function Pro({ me }: { me: Me }) {
  const [period, setPeriod] = useState<'yearly' | 'monthly'>('yearly');
  const [run, busy, error] = useAction();
  return (
    <main className="screen" style={{ padding: '20px 20px 26px', gap: 16 }}>
      <div className="row" style={{ justifyContent: 'flex-end' }}><a className="sq" href="/" aria-label="Close" onClick={(e) => { e.preventDefault(); navigate('/'); }}>✕</a></div>
      <div className="stack center" style={{ alignItems: 'center', gap: 10 }}><Mascot size={128} bob label="Zorion in gold star sunglasses" /><h1 className="display h0">Go Pro. Go superstar.</h1><p className="small" style={{ fontSize: 15 }}>Zorion puts on the star shades. Your meetups lose the ads and gain the extras.</p></div>
      <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10 }}>{BENEFITS.map((b, i) => <li key={b} className="row rise" style={{ animationDelay: `${0.1 + i * 0.08}s` }}><Check />{b}</li>)}</ul>
      {me.plan === 'pro' ? <Note ok>You are on Pro.</Note> : (
        <>
          <div className="grid2" role="radiogroup" aria-label="Billing period">
            {(['yearly', 'monthly'] as const).map((p) => <button key={p} className="theme-tile" style={{ minHeight: 72 }} role="radio" aria-checked={period === p} aria-pressed={period === p} onClick={() => setPeriod(p)}><span style={{ fontSize: 13, fontWeight: 700 }}>{p === 'yearly' ? 'Yearly' : 'Monthly'}</span><span className="small">{p === 'yearly' ? 'Best value' : 'Cancel anytime'}</span></button>)}
          </div>
          <Oops>{error}</Oops>
          <div className="push stack" style={{ gap: 10 }}>
            <Btn busy={busy} onClick={() => run(async () => { location.href = (await api('POST', '/billing/checkout', { period })).url; })}>Continue to secure checkout</Btn>
            <p className="small center">The price is shown at checkout. Payment is handled by Stripe. Zorion never sees your card.</p>
          </div>
        </>
      )}
    </main>
  );
}

export function ProWelcome() {
  return (
    <main className="screen" style={{ padding: '20px 20px 26px', gap: 20 }}>
      <div className="grow row" style={{ justifyContent: 'center', alignItems: 'flex-end' }}><Mascot size={260} full bob label="Zorion as a superstar" /></div>
      <div className="stack center rise" style={{ alignItems: 'center', gap: 10 }}><Chip kind="pro">Pro</Chip><h1 className="display h0">You're a superstar.</h1><p style={{ color: 'var(--muted)' }}>Pro is on. The ads are gone and your crew can grow. It can take a moment to show.</p></div>
      <Btn to="/">Back to my meetups</Btn>
    </main>
  );
}
