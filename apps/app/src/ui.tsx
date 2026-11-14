import { type ReactNode, useContext, useEffect, useId, useRef, useState } from 'react';
import { ART, AVATAR_ART, AVATAR_VIEWBOX, type Avatar, ICONS } from '@zorion/core';
import { Link, Look, api, openPro, useConfig } from './lib';

const svg = (inner: string, viewBox: string, size: number, ratio = 1, label?: string) => (
  <svg viewBox={viewBox} width={size} height={Math.round(size * ratio)} style={{ flex: 'none' }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} dangerouslySetInnerHTML={{ __html: inner }} />
);

/** Zorion the black pig. Chef hat on the pink theme, star shades on gold. A light rim keeps him visible on dark. Drawn by scripts/mascot.mjs. */
export function Mascot({ size = 64, full = false, bob = false, label }: { size?: number; full?: boolean; bob?: boolean; label?: string }) {
  const { theme, mode } = useContext(Look);
  const star = theme === 'gold';
  const dark = mode === 'dark';
  const art = full ? (star ? ART.fullStarRim : dark ? ART.fullChefRim : ART.fullChef) : star ? (dark ? ART.headStarRim : ART.headStar) : dark ? ART.headChefRim : ART.headChef;
  const el = full ? svg(art!, '0 -22 240 254', size, 254 / 240, label) : svg(art!, '-6 -14 132 126', size, 126 / 132, label);
  return bob ? <span className="bob" style={{ display: 'flex', flex: 'none' }}>{el}</span> : el;
}

export const Icon = ({ name, size = 26 }: { name: string; size?: number }) => svg(ICONS[name] ?? ICONS.star!, '0 0 24 24', size);
const line = (d: string, size = 20, w = 2.5) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ flex: 'none' }}>
    <path d={d} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const Check = ({ size = 18 }: { size?: number }) => line('M5 12.5 L10 17.5 L19 7', size, 3);
export const Chevron = () => line('M9 5 L16 12 L9 19', 18);
export const Plus = () => line('M12 5 V19 M5 12 H19', 18);
export const Back = () => line('M15 5 L8 12 L15 19', 20);
export const Cross = () => line('M6 6 L18 18 M18 6 L6 18', 18);

/** A host's pig: the picture they picked in Account. It bobs gently; the one being picked wiggles. */
export function Pig({ avatar, size = 40, motion = 'bob', label, delay = 0 }: { avatar?: string | null; size?: number; motion?: 'bob' | 'wiggle' | 'none'; label?: string; delay?: number }) {
  const art = AVATAR_ART[(avatar as Avatar) in AVATAR_ART ? (avatar as Avatar) : 'chef'];
  return (
    <span className="pig" style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox={AVATAR_VIEWBOX} width={Math.round(size * 0.86)} height={Math.round(size * 0.86)} className={motion === 'none' ? undefined : motion} style={{ animationDelay: `${delay}ms` }} dangerouslySetInnerHTML={{ __html: art }} />
    </span>
  );
}

/** Where the meetup is up to. Hosts: Invite, (Date), Food, Place, Confirmed. Guests: Reply, (Date), Food, Place, Confirmed. */
export function Steps({ names, current }: { names: string[]; current: number }) {
  return (
    <ol className="steps" aria-label={`Step ${current + 1} of ${names.length}: ${names[current]}`}>
      {names.map((n, i) => <li key={n} className={i < current ? 'done' : i === current ? 'now' : ''} aria-current={i === current ? 'step' : undefined}><i /><span>{n}</span></li>)}
    </ol>
  );
}
export const hostSteps = (dateVote: boolean) => (dateVote ? ['Invite', 'Date', 'Food', 'Place', 'Confirmed'] : ['Invite', 'Food', 'Place', 'Confirmed']);
export const guestSteps = (dateVote: boolean) => (dateVote ? ['Reply', 'Date', 'Food', 'Place', 'Confirmed'] : ['Reply', 'Food', 'Place', 'Confirmed']);

/** The bottom buttons of a screen. Stick to the bottom on a phone, sit after the content on a desktop. */
export const Actions = ({ children }: { children: ReactNode }) => <div className="actions">{children}</div>;

/** A small "Pro" tag that opens the Pro sheet. */
export const ProTag = () => <button type="button" className="chip pro" onClick={(e) => { e.stopPropagation(); openPro(); }}>Pro</button>;

export function Header({ title, sub, back, onBack, steps, right }: { title: ReactNode; sub?: ReactNode; back?: string; onBack?: () => void; steps?: { names: string[]; current: number }; right?: ReactNode }) {
  return (
    <header className="head">
      <div className="head-row">
        {back && <Link to={back} className="sq" aria-label="Back"><Back /></Link>}
        {onBack && <button className="sq" aria-label="Back" onClick={onBack}><Back /></button>}
        <div className="head-title">
          <h1 className="display h2">{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {right}
      </div>
      {steps && <Steps names={steps.names} current={steps.current} />}
    </header>
  );
}

export function Btn({ children, onClick, to, kind, disabled, busy, className = '', type = 'button' }: { children: ReactNode; onClick?: () => void; to?: string; kind?: 'second' | 'text'; disabled?: boolean; busy?: boolean; className?: string; type?: 'button' | 'submit' }) {
  const cls = `btn ${kind ?? ''} ${className}`;
  if (to && !disabled) return <Link to={to} className={cls}>{children}</Link>;
  return <button type={type} className={cls} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}>{busy ? 'One moment…' : children}</button>;
}

export function Field({ label, value, onChange, max, type = 'text', placeholder, autoComplete, inputMode }: { label: string; value: string; onChange: (v: string) => void; max?: number; type?: string; placeholder?: string; autoComplete?: string; inputMode?: 'numeric' | 'email' | 'text' }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}{max && <span>{[...value].length} / {max}</span>}</label>
      <input id={id} className="input" type={type} value={value} maxLength={max} placeholder={placeholder} autoComplete={autoComplete} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** One box per character, for 6-digit codes and the 4-character guest code. Paste fills every box. */
export function Codes({ length, value, onChange, big, readOnly, digits = true, label }: { length: number; value: string; onChange?: (v: string) => void; big?: boolean; readOnly?: boolean; digits?: boolean; label: string }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const clean = (s: string) => (digits ? s.replace(/\D/g, '') : s.replace(/[^0-9a-z]/gi, '').toUpperCase()).slice(0, length);
  const put = (i: number, raw: string) => {
    const typed = clean(raw);
    const next = clean(value.slice(0, i) + typed + value.slice(i + (typed.length || 1)));
    onChange?.(next);
    refs.current[Math.min(i + typed.length, length - 1)]?.focus();
  };
  return (
    <div className={`codes ${big ? 'big' : ''}`} role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          aria-label={`Character ${i + 1}`}
          value={value[i] ?? ''}
          readOnly={readOnly}
          inputMode={digits ? 'numeric' : 'text'}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          onChange={(e) => put(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !value[i] && i > 0) {
              onChange?.(value.slice(0, i - 1));
              refs.current[i - 1]?.focus();
            }
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

export function Pick({ on, onClick, title, meta, lead, right, radio, disabled, delay }: { on: boolean; onClick?: () => void; title: ReactNode; meta?: ReactNode; lead?: ReactNode; right?: ReactNode; radio?: boolean; disabled?: boolean; delay?: number }) {
  const aria = radio ? { role: 'radio' as const, 'aria-checked': on } : { 'aria-pressed': on };
  return (
    <button type="button" className="pick rise" {...aria} onClick={onClick} disabled={disabled} style={delay !== undefined ? { animationDelay: `${delay}ms` } : undefined}>
      {lead}
      <span className="grow stack" style={{ gap: 0 }}>
        <strong>{title}</strong>
        {meta && <span className="small">{meta}</span>}
      </span>
      {right}
      <span className="mark">{on && <span className="pop" style={{ display: 'flex' }}><Check size={20} /></span>}</span>
    </button>
  );
}

export const Chip = ({ children, kind }: { children: ReactNode; kind?: 'plain' | 'sel' | 'pro' | 'ok' }) => <span className={`chip ${kind ?? ''}`}>{children}</span>;
export const Note = ({ children, ok }: { children: ReactNode; ok?: boolean }) => <div className={`note ${ok ? 'ok' : ''}`}>{ok && <Check />}<span>{children}</span></div>;
export const Oops = ({ children }: { children: ReactNode }) => (children ? <div className="err" role="alert">{children}</div> : null);

export function Facts({ rows, title }: { rows: Array<[string, ReactNode, ReactNode?]>; title?: string }) {
  return (
    <div className="card" style={{ padding: '4px 14px' }}>
      {title && <div className="small" style={{ fontWeight: 700, padding: '8px 0 2px' }}>{title}</div>}
      <dl className="facts" style={{ margin: 0 }}>
        {rows.map(([k, v, extra]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd>{extra}</div>
        ))}
      </dl>
    </div>
  );
}

export function Tally({ rows, total }: { rows: Array<{ label: string; votes: number }>; total: number }) {
  return (
    <div className="tally">
      {rows.map((r, i) => (
        <div key={r.label}>
          <span>{r.label}</span>
          <i><b style={{ width: `${Math.max(total ? (r.votes * 100) / total : 0, 2)}%`, animationDelay: `${0.2 + i * 0.1}s` }} /></i>
          <em>{r.votes}</em>
        </div>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, title, meta }: { on: boolean; onChange: (v: boolean) => void; title: string; meta?: string }) {
  return (
    <button className="switch" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="grow stack" style={{ gap: 0 }}><strong style={{ fontWeight: 800 }}>{title}</strong>{meta && <span className="small">{meta}</span>}</span>
      <i aria-hidden="true" />
    </button>
  );
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; locked?: boolean }> }) {
  return (
    <div className="seg" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) =>
        o.locked ? (
          <button key={o.value} type="button" className="locked" onClick={openPro}>{o.label}<Chip kind="pro">Pro</Chip></button>
        ) : (
          <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
        ),
      )}
    </div>
  );
}

/** First-party sponsored slot. Pro viewers get nothing back from the API, so nothing renders. */
/** A first-party sponsored spot. Shown when no Google ad can be. */
export function Sponsored({ placement, category, show = true }: { placement: string; category?: string | null; show?: boolean }) {
  const [ad, setAd] = useState<{ name: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!show) return;
    let live = true;
    api('GET', `/ads/${placement}${category ? `?category=${encodeURIComponent(category)}` : ''}`).then((r) => live && setAd(r.ad)).catch(() => {});
    return () => { live = false; };
  }, [placement, category, show]);
  if (!show || !ad) return null;
  const inner = <><span><strong>Sponsored</strong> · {ad.name}</span></>;
  return ad.url ? <a className="sponsored" href={ad.url} target="_blank" rel="noopener noreferrer sponsored">{inner}</a> : <div className="sponsored">{inner}</div>;
}

const CONSENT_KEY = 'zorion-google-ads';
/**
 * An ad spot: a Google ad when one can show, otherwise a sponsored spot.
 * The Google ad loads in a frame from the landing site, a different origin, so it cannot read anything in the app.
 */
export function AdSlot({ placement, show }: { placement: string; show: boolean }) {
  const config = useConfig();
  const [consent, setConsent] = useState<string | null>(() => { try { return localStorage.getItem(CONSENT_KEY); } catch { return null; } });
  const [state, setState] = useState<'trying' | 'google' | 'fallback'>('trying');
  const google = !!config?.googleAds && config.googleAds.placements.includes(placement);
  const allowed = google && (!config!.googleAds!.consent || consent === 'yes');
  useEffect(() => {
    if (!show || !config) return;
    if (!allowed) { setState('fallback'); return; }
    setState('trying');
    const origin = new URL(config.siteOrigin).origin;
    const onMessage = (e: MessageEvent) => { if (e.origin === origin && e.data?.zorionAd) setState(e.data.zorionAd === 'filled' ? 'google' : 'fallback'); };
    window.addEventListener('message', onMessage);
    const t = setTimeout(() => setState((s) => (s === 'trying' ? 'fallback' : s)), 5000);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(t); };
  }, [show, config, allowed]);
  if (!show || !config) return null;
  const choose = (v: 'yes' | 'no') => { try { localStorage.setItem(CONSENT_KEY, v); } catch { /* private mode: ask again next time */ } setConsent(v); };
  return (
    <>
      {google && config.googleAds!.consent && consent === null && (
        <div className="consent" role="region" aria-label="Ads">
          <span>Allow ads from Google? They keep Zorion free.</span>
          <span className="row" style={{ gap: 8 }}><button className="btn second" onClick={() => choose('no')}>No</button><button className="btn" onClick={() => choose('yes')}>Allow</button></span>
        </div>
      )}
      {allowed && state !== 'fallback' && (
        <div className="adframe" style={state === 'google' ? undefined : { height: 0, overflow: 'hidden' }}>
          <small>Advertisement</small>
          <iframe title="Advertisement" src={`${config.siteOrigin}/ad-frame?slot=${encodeURIComponent(placement)}&consent=yes`} sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      )}
      {state === 'fallback' && <Sponsored placement={placement} />}
    </>
  );
}

/** Zorion's own error screen, inside the app's frame. */
export function ErrorScreen({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <main className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 14 }} role="alert">
      <Mascot size={96} />
      <h1 className="display h1">{title}</h1>
      <p style={{ color: 'var(--muted)', margin: 0 }}>{text}</p>
      {action && <div style={{ width: '100%', maxWidth: 320 }}>{action}</div>}
    </main>
  );
}

export function Person({ name, tag, right, onClick, to, pig }: { name: string; tag?: string; right?: ReactNode; onClick?: () => void; to?: string; pig?: string }) {
  const inner = (
    <>
      {pig ? <Pig avatar={pig} size={32} /> : <span className="avatar">{name[0]?.toUpperCase()}</span>}
      <span className="grow wrap" style={{ fontWeight: 700, fontSize: 15 }}>{name}{tag && <span className="small" style={{ fontWeight: 500 }}> {tag}</span>}</span>
      {right}
    </>
  );
  if (to) return <Link to={to} className="person">{inner}</Link>;
  return onClick ? <button className="person" onClick={onClick}>{inner}</button> : <div className="person">{inner}</div>;
}

export const Remove = ({ label, onClick }: { label: string; onClick: () => void }) => <button className="sq" style={{ background: 'transparent', color: 'var(--muted)' }} aria-label={label} onClick={onClick}><Cross /></button>;
export const Loading = () => <div className="loading"><Mascot size={72} bob label="Loading" /></div>;

export function Toast({ text, onDone }: { text: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return text ? <div className="toast" role="status">{text}</div> : null;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Asks the browser for the device position, once. */
export function locate(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser can't share location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Location is blocked. Allow it in your browser settings.' : "Couldn't get your location. Try again.")),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}
