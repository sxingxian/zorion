import { useEffect, useState } from 'react';
import { AVATARS, AVATAR_NAMES, LIMITS, PRO_AVATARS, type Plans, TRAVEL_LABEL, formatPrice } from '@zorion/core';
import { Link, type Me, type ModeChoice, api, closeSheet, navigate, openPro, useAction, useConfig, useInstall, useSession } from './lib';
import { Actions, Btn, Check, Chevron, Chip, Codes, Facts, Field, Header, Loading, Mascot, Note, Oops, Pig, Seg, Switch, Toast } from './ui';
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
  const install = useInstall();
  const [editingName, setEditingName] = useState(false);
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
  const gold = me.features.goldTheme;
  const go = (v: typeof view) => { clear(); setCode(''); setView(v); };
  const patch = (body: unknown) => run(async () => { await api('PATCH', '/account', body); await refresh(); });

  if (view === 'password') {
    return (
      <>
        <Header title={me.has_password ? 'Change password' : 'Add a password'} sub={me.email} onBack={() => go('main')} />
        <main className="screen" style={{ gap: 14 }}>
          {me.has_password && <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={setCurrent} />}
          <Field label="New password" type="password" autoComplete="new-password" value={next} onChange={setNext} />
          <p className="small">At least 10 characters. Other devices are signed out.</p>
          <Oops>{error}</Oops>
          <Actions><Btn busy={busy} disabled={next.length < 10} onClick={async () => (await run(async () => { await api('POST', '/account/password', { current, next }); await refresh(); })) && (setToast('Password saved'), setCurrent(''), setNext(''), go('main'))}>Save</Btn></Actions>
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
            <p className="small" style={{ fontSize: 14 }}>Two-step is on. Keep these safe: each signs you in once if you lose your authenticator.</p>
            <div className="card grid2" style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700 }}>{recovery.map((r) => <span key={r}>{r}</span>)}</div>
            <Actions><Btn onClick={() => { setRecovery(null); setSetup(null); go('main'); }}>Saved them</Btn></Actions>
          </main>
        </>
      );
    }
    if (me.totp_enabled) {
      return (
        <>
          <Header title="Two-step verification" sub="On" onBack={() => go('main')} />
          <main className="screen" style={{ gap: 14 }}>
            <h2 className="display h1">Turn it off</h2>
            <p className="small" style={{ fontSize: 14 }}>Enter an authenticator code to confirm.</p>
            <Codes length={6} value={code} onChange={setCode} label="Authenticator code" />
            <Oops>{error}</Oops>
            <Actions><Btn kind="second" busy={busy} disabled={code.length !== 6} onClick={async () => (await run(async () => { await api('POST', '/account/two-step/disable', { code }); await refresh(); })) && go('main')}>Turn off</Btn></Actions>
          </main>
        </>
      );
    }
    return (
      <>
        <Header title="Two-step verification" sub="Off" onBack={() => go('main')} />
        <main className="screen" style={{ gap: 14 }}>
          {!setup ? (
            <>
              <p className="small" style={{ fontSize: 14 }}>Sign-in will ask for your authenticator as well as your email code or password.</p>
              <Oops>{error}</Oops>
              <Actions><Btn busy={busy} onClick={() => run(async () => setSetup(await api('POST', '/account/two-step/setup')))}>Set up</Btn></Actions>
            </>
          ) : (
            <>
              <h2 className="display h1">Add Zorion to your app</h2>
              <QrCode text={setup.uri} />
              <p className="small center">Scan with your authenticator app.</p>
              <a className="btn second" href={setup.uri}>Open authenticator app</a>
              <Facts rows={[['Key', <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{setup.secret}</span>]]} />
              <p className="small">Then enter the code it shows.</p>
              <Codes length={6} value={code} onChange={setCode} label="Authenticator code" />
              <Oops>{error}</Oops>
              <Actions><Btn busy={busy} disabled={code.length !== 6} onClick={() => run(async () => { const r = await api('POST', '/account/two-step/enable', { code }); await refresh(); setRecovery(r.recovery); })}>Turn on</Btn></Actions>
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
          <Note>This deletes your account and all your meetups. It can't be undone.</Note>
          <Field label="Type your email to confirm" type="email" value={confirm} onChange={setConfirm} />
          <Oops>{error}</Oops>
          <Actions><Btn kind="second" busy={busy} disabled={confirm.trim().toLowerCase() !== me.email} onClick={async () => (await run(async () => { await api('POST', '/account/delete', { email: confirm }); await refresh(); })) && navigate('/', true)}>Delete everything</Btn></Actions>
        </main>
      </>
    );
  }
  return (
    <>
      <Header title="Account" back="/" />
      <main className="screen" style={{ gap: 20 }}>
        <div className="row" style={{ gap: 14 }}>
          <Link to="/account/pig" className="pigedit" aria-label="Change your pig"><Pig avatar={me.avatar} size={64} /><span aria-hidden="true">✎</span></Link>
          {editingName ? (
            <form className="grow row" style={{ alignItems: 'flex-end' }} onSubmit={async (e) => { e.preventDefault(); if (await patch({ displayName: name })) { setEditingName(false); setToast('Name saved'); } }}>
              <div className="grow"><Field label="Your name" value={name} max={LIMITS.inviteeName} onChange={setName} /></div>
              <button className="btn sm" style={{ minHeight: 52 }} disabled={busy || !name.trim()}>Save</button>
            </form>
          ) : (
            <>
              <div className="grow stack" style={{ gap: 0 }}><strong style={{ fontSize: 17 }}>{me.display_name}</strong><span className="small" style={{ fontSize: 14 }}>{me.email}</span></div>
              <button className="btn second sm" onClick={() => setEditingName(true)}>Edit name</button>
            </>
          )}
        </div>
        <Oops>{error}</Oops>
        <div className="card row between" style={{ padding: '14px 16px' }}>
          <div className="stack" style={{ gap: 0 }}><strong style={{ fontWeight: 800 }}>{pro ? 'Pro' : 'Free'}</strong><span className="small">{pro ? 'No ads' : `Up to ${me.features.groupSize} people${me.features.ads ? ', with ads' : ''}`}</span></div>
          {pro ? <button className="btn second sm" disabled={busy} onClick={() => run(async () => { location.href = (await api('POST', '/billing/portal')).url; })}>Manage</button> : <button className="btn sm" onClick={openPro}>Upgrade</button>}
        </div>
        <div className="group"><span className="label">Appearance</span>
          <Seg value={modeChoice} onChange={setMode} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: 'Auto' }]} />
          {gold && <div style={{ marginTop: 8 }}><Seg value={me.theme} onChange={(theme) => patch({ theme })} options={[{ value: 'gold', label: 'Gold' }, { value: 'pink', label: 'Pink' }]} /></div>}
        </div>
        <div className="group"><span className="label">Updates</span>
          <div className="stack">
            <Switch on={me.notify} title="Email" meta="Votes in, replies changed" onChange={(notify) => run(async () => { await api('PATCH', '/account', { notify }); await refresh(); })} />
            {me.telegram_ready && (tgLink && !me.telegram
              ? <TelegramLink url={tgLink} onCancel={() => setTgLink(null)} />
              : (
                <div className="switch" style={{ cursor: 'default' }}>
                  <span className="grow stack" style={{ gap: 0 }}><strong style={{ fontWeight: 800 }}>Telegram</strong><span className="small">{me.telegram ? 'Connected' : 'Same updates as email'}</span></span>
                  {me.telegram
                    ? <button type="button" className="btn second sm" disabled={busy} onClick={() => run(async () => { await api('POST', '/account/telegram/stop', {}); await refresh(); })}>Disconnect</button>
                    : <button type="button" className="btn second sm" disabled={busy} onClick={() => run(async () => setTgLink((await api('POST', '/account/telegram', {})).url))}>Connect</button>}
                </div>
              ))}
          </div>
        </div>
        {install.can && <div className="group"><span className="label">App</span><div className="list"><button className="li" onClick={install.install}><strong>Add to home screen</strong><span className="row small">Install <Chevron /></span></button></div></div>}
        <div className="group"><span className="label">Sign-in</span>
          <div className="list">
            <button className="li" onClick={() => go('password')}><strong>Password</strong><span className="row small">{me.has_password ? 'Change' : 'Add'} <Chevron /></span></button>
            <button className="li" onClick={() => go('two_step')}><strong>Two-step</strong><span className="row small">{me.totp_enabled ? 'On' : 'Off'} <Chevron /></span></button>
          </div>
        </div>
        <div className="grid3">
          <a className="btn second sm" style={{ width: '100%' }} href="/api/account/export" download="zorion-data.json">Export</a>
          <button className="btn second sm" style={{ width: '100%' }} onClick={() => run(async () => { await api('POST', '/auth/sign-out'); await refresh(); navigate('/', true); })}>Sign out</button>
          <button className="btn second sm danger" style={{ width: '100%' }} onClick={() => go('delete')}>Delete</button>
        </div>
        <Toast text={toast} onDone={() => setToast(null)} />
      </main>
    </>
  );
}

/** Pick the pig that stands for you. Guests see it on your meetups. */
export function PickPig({ me }: { me: Me }) {
  const { refresh } = useSession();
  const [pick, setPick] = useState(me.avatar ?? 'chef');
  const [run, busy, error] = useAction();
  const gold = me.features.goldTheme;
  return (
    <>
      <Header title="Your pig" back="/account" />
      <main className="screen" style={{ gap: 18 }}>
        <div className="stack center" style={{ alignItems: 'center', gap: 10, padding: '6px 0' }}><Pig avatar={pick} size={132} motion="wiggle" label={AVATAR_NAMES[pick as keyof typeof AVATAR_NAMES]} /><p className="small" style={{ fontSize: 14 }}>Guests see this on your meetups.</p></div>
        <div className="grid3 stagger" role="radiogroup" aria-label="Pigs">
          {AVATARS.map((k, i) => {
            const locked = PRO_AVATARS.includes(k) && !gold;
            return (
              <button key={k} type="button" className="pigtile" role="radio" aria-checked={pick === k} aria-label={`${AVATAR_NAMES[k]}${locked ? ' (Pro)' : ''}`} onClick={() => (locked ? openPro() : setPick(k))}>
                <Pig avatar={k} size={56} motion={pick === k ? 'wiggle' : 'bob'} delay={i * 180} />
                <span>{AVATAR_NAMES[k]}</span>
                {locked && <span className="chip pro" style={{ position: 'absolute', top: 6, right: 6 }}>Pro</span>}
              </button>
            );
          })}
        </div>
        <Oops>{error}</Oops>
        <Actions><Btn busy={busy} disabled={pick === me.avatar} onClick={async () => (await run(async () => { await api('PATCH', '/account', { avatar: pick }); await refresh(); })) && navigate('/account')}>Save</Btn></Actions>
      </main>
    </>
  );
}

/** What Pro adds over Free, worded from the plans set in the admin portal. */
function benefits(plans: Plans): string[] {
  const { free, pro } = plans;
  const out: string[] = [];
  if (free.ads && !pro.ads) out.push('No ads');
  if (pro.groupSize > free.groupSize) out.push(`Groups of up to ${pro.groupSize} (Free: ${free.groupSize})`);
  if (free.activeMeetups > 0 && (pro.activeMeetups === 0 || pro.activeMeetups > free.activeMeetups)) out.push(pro.activeMeetups === 0 ? 'Any number of meetups at a time' : `${pro.activeMeetups} meetups at a time`);
  const extra = pro.travel.filter((m) => !free.travel.includes(m));
  if (extra.length) out.push(`${extra.map((m, i) => (i ? TRAVEL_LABEL[m].toLowerCase() : TRAVEL_LABEL[m])).join(' and ')} times`);
  if (pro.ownCategories && !free.ownCategories) out.push('Your own food options');
  if (pro.goldTheme && !free.goldTheme) out.push(pro.guestTheme && !free.guestTheme ? 'Gold theme for you and your guests' : 'Gold theme');
  else if (pro.guestTheme && !free.guestTheme) out.push('Gold theme for your guests');
  return out;
}

export function Pro({ me, sheet = false }: { me: Me; sheet?: boolean }) {
  const config = useConfig();
  const [period, setPeriod] = useState<'yearly' | 'monthly'>('yearly');
  const [run, busy, error] = useAction();
  const price = config?.plans.price;
  const options = (['yearly', 'monthly'] as const).filter((p) => !price || price[p] > 0);
  useEffect(() => { if (price && !price[period] && options[0]) setPeriod(options[0]); }, [price, period, options]);
  const onSale = !!price && (price.monthly > 0 || price.yearly > 0);
  return (
    <main className="screen" style={{ padding: sheet ? 0 : '20px 20px 26px', gap: 16 }}>
      {!sheet && <div className="row" style={{ justifyContent: 'flex-end' }}><a className="sq" href="/" aria-label="Close" onClick={(e) => { e.preventDefault(); if (history.length > 1) history.back(); else navigate('/'); }}>✕</a></div>}
      <div className="stack center" style={{ alignItems: 'center', gap: 10 }}><Mascot size={128} bob label="Zorion in gold star sunglasses" /><h1 className="display h0">Zorion Pro</h1></div>
      {config && <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10 }}>{benefits(config.plans).map((b, i) => <li key={b} className="row rise" style={{ animationDelay: `${0.1 + i * 0.08}s` }}><Check />{b}</li>)}</ul>}
      {me.plan === 'pro' ? <Note ok>You're on Pro.</Note> : !config ? <Loading /> : !onSale ? <Note>Pro isn't on sale yet.</Note> : (
        <>
          <div className="grid2" role="radiogroup" aria-label="Billing period">
            {options.map((p) => <button key={p} className="theme-tile" style={{ minHeight: 72 }} role="radio" aria-checked={period === p} aria-pressed={period === p} onClick={() => setPeriod(p)}><span style={{ fontSize: 13, fontWeight: 700 }}>{p === 'yearly' ? 'Yearly' : 'Monthly'}</span><span style={{ fontWeight: 800 }}>{formatPrice(price![p])}{p === 'yearly' ? ' / year' : ' / month'}</span></button>)}
          </div>
          <Oops>{error}</Oops>
          <div className="push stack" style={{ gap: 10 }}>
            <Btn busy={busy} onClick={() => run(async () => { location.href = (await api('POST', '/billing/checkout', { period })).url; })}>Continue</Btn>
            <p className="small center">Cancel any time.</p>
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
      <div className="stack center rise" style={{ alignItems: 'center', gap: 10 }}><Chip kind="pro">Pro</Chip><h1 className="display h0">You're on Pro</h1><p style={{ color: 'var(--muted)' }}>It may take a moment to show.</p></div>
      <Btn to="/">Done</Btn>
    </main>
  );
}
