import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ART, ICONS } from '@zorion/core';

const svgArt = (inner: string, viewBox: string, size: number, ratio: number, label?: string) => (
  <svg viewBox={viewBox} width={size} height={Math.round(size * ratio)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} dangerouslySetInnerHTML={{ __html: inner }} />
);
const Head = ({ size = 40 }: { size?: number }) => svgArt(ART.headChef!, '-6 -14 132 126', size, 126 / 132);
const Pig = ({ size, star, label }: { size: number; star?: boolean; label?: string }) => svgArt(star ? ART.fullStarRim! : ART.fullChef!, '0 -22 240 254', size, 254 / 240, label);
const Food = ({ name, size = 30 }: { name: string; size?: number }) => svgArt(ICONS[name]!, '0 0 24 24', size, 1);

/** The drawn city used behind the hero and in each scene. Decorative. */
function City({ children, dark }: { children?: ReactNode; dark?: boolean }) {
  const road = dark ? '#2a2a31' : '#fff';
  return (
    <svg className="city" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="800" height="600" fill={dark ? '#17171b' : '#ececf0'} />
      <path d="M0 470 Q260 400 800 500 V600 H0 Z" fill={dark ? '#18202c' : '#dce6f2'} />
      <rect x="520" y="70" width="190" height="130" rx="26" fill={dark ? '#1a211b' : '#e1ecdd'} />
      {[60, 180, 300, 420, 540, 660, 760].map((x, i) => <path key={x} d={`M${x} 0 V600`} stroke={road} strokeWidth={i % 3 === 0 ? 18 : 10} />)}
      {[50, 160, 270, 380, 490].map((y, i) => <path key={y} d={`M0 ${y} H800`} stroke={road} strokeWidth={i % 2 === 0 ? 18 : 10} />)}
      {children}
    </svg>
  );
}
const Pin = ({ x, y, letter }: { x: number; y: number; letter: string }) => (
  <g><circle cx={x} cy={y} r="22" fill="#0b0b0d" /><text x={x} y={y + 6} textAnchor="middle" fontSize="18" fontWeight="700" fill="#fff" fontFamily="system-ui">{letter}</text></g>
);
const CREW: Array<[number, number, string]> = [[150, 120, 'M'], [640, 100, 'A'], [90, 400, 'S'], [700, 420, 'L'], [300, 520, 'P']];
// The hero has its own pins, kept clear of the headline card, the mascot and the header button.
const HERO_CREW: Array<[number, number, string]> = [[150, 120, 'M'], [330, 190, 'S'], [560, 140, 'A'], [720, 250, 'L'], [520, 480, 'P']];

const SCENES = [
  { n: '01', title: 'Put food on the ballot.', text: 'You choose up to six: pizza, ramen, tacos, or your own. Then you vote first.', art: (
    <City><g>{['pizza', 'ramen', 'tacos', 'bar', 'izakaya', 'hotpot'].map((k, i) => <g key={k} transform={`translate(${150 + (i % 3) * 180} ${170 + Math.floor(i / 3) * 170})`}><rect width="140" height="120" rx="24" fill={i < 3 ? '#0b0b0d' : '#fff'} /><g transform="translate(50 36)" color={i < 3 ? '#fff' : '#0b0b0d'}><Food name={k} size={44} /></g></g>)}</g></City>
  ) },
  { n: '02', title: 'One link. No accounts.', text: 'Your crew taps their name, shares where they are once, and votes for up to half. Nobody downloads anything.', art: (
    <City>{CREW.map(([x, y, l]) => <Pin key={l} x={x} y={y} letter={l} />)}<rect x="270" y="230" width="260" height="120" rx="28" fill="#fff" /><text x="400" y="282" textAnchor="middle" fontSize="26" fontWeight="700" fontFamily="system-ui" fill="#0b0b0d">zorionapp…/j/7K4P</text><text x="400" y="318" textAnchor="middle" fontSize="18" fill="#5a5a63" fontFamily="system-ui">No account needed to join</text></City>
  ) },
  { n: '03', title: 'Meet in the fair middle.', text: 'Zorion finds the spot that keeps the longest walk as short as it can be, then shows the places closest to everyone.', art: (
    <City><circle cx="400" cy="300" r="150" fill="#ffa6fc" opacity="0.35" /><path d={CREW.map(([x, y]) => `M${x} ${y} H400 V300`).join(' ')} fill="none" stroke="#0b0b0d" strokeWidth="5" strokeDasharray="12 12" strokeLinecap="round" style={{ animation: 'dash 1.4s linear infinite' }} />{CREW.map(([x, y, l]) => <Pin key={l} x={x} y={y} letter={l} />)}<circle cx="400" cy="300" r="46" fill="#fff" stroke="#0b0b0d" strokeWidth="3" /><g transform="translate(364 266) scale(0.6)" dangerouslySetInnerHTML={{ __html: ART.headChef! }} /></City>
  ) },
];

const PLANS: Array<[string, string, string]> = [
  ['Meetups, votes and the fair middle', 'Yes', 'Yes'],
  ['Date vote, replies and guest codes', 'Yes', 'Yes'],
  ['Ads and sponsored spots', 'Shown', 'None'],
  ['Getting there', 'Walking', 'Walk, transit, cycle'],
  ['Your own categories, with an icon', '—', 'Yes'],
  ['Theme for you and your guests', 'Pink', 'Pink or gold'],
  ['Group size', 'Smaller groups', 'Larger groups'],
];
const PROMISES: Array<[string, string]> = [
  ['Fair.', 'The middle keeps the longest walk short, so nobody draws the short straw.'],
  ['Private.', 'A guest’s location is used once and never shown to the crew.'],
  ['Quick.', 'One link from start to finish. Guests never make an account.'],
  ['Free.', 'Hosting is free. Pro removes the ads and adds the extras.'],
];

interface Config { appUrl: string; adsense: { publisherId: string; consent: boolean } | null }

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [consent, setConsent] = useState<string | null>(() => localStorage.getItem('zorion-ads'));
  const app = config?.appUrl ?? 'https://zorionapp.midnightpoetry.studio';

  useEffect(() => { fetch('/api/public/config').then((r) => r.json()).then(setConfig).catch(() => {}); }, []);

  // Smooth scrolling and scroll-driven motion. Skipped entirely for people who prefer reduced motion.
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cleanup = () => {};
    let live = true;
    (async () => {
      const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('lenis')]);
      if (!live || !root.current) return;
      gsap.registerPlugin(ScrollTrigger);
      const lenis = new Lenis();
      lenis.on('scroll', ScrollTrigger.update);
      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      const ctx = gsap.context(() => {
        gsap.from('.hero .card > *', { y: 30, opacity: 0, duration: 0.8, stagger: 0.08, ease: 'power3.out' });
        gsap.to('.hero .walker', { xPercent: -40, yPercent: 20, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
        gsap.utils.toArray<HTMLElement>('.reveal').forEach((el) => gsap.to(el, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 82%' } }));
        gsap.utils.toArray<HTMLElement>('.scene .art').forEach((el) => gsap.fromTo(el, { scale: 0.92 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'center center', scrub: true } }));
        gsap.fromTo('.closing .giant', { yPercent: 30 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.closing', start: 'top bottom', end: 'bottom bottom', scrub: true } });
      }, root);
      cleanup = () => {
        ctx.revert();
        gsap.ticker.remove(tick);
        lenis.destroy();
      };
    })();
    return () => {
      live = false;
      cleanup();
    };
  }, []);

  // AdSense runs here only, never inside the app, and only after consent when that is required.
  const ads = config?.adsense;
  const adsAllowed = !!ads && (!ads.consent || consent === 'yes');
  useEffect(() => {
    if (!adsAllowed || !ads || document.querySelector('script[data-zorion-ads]')) return;
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ads.publisherId)}`;
    s.crossOrigin = 'anonymous';
    s.dataset.zorionAds = '1';
    document.head.appendChild(s);
  }, [adsAllowed, ads]);
  const decide = (v: 'yes' | 'no') => { localStorage.setItem('zorion-ads', v); setConsent(v); };

  return (
    <div className="land" ref={root}>
      <header className="top"><div className="wrap"><a className="brandmark" href="/"><Head />Zorion</a><a className="cta dark" style={{ minHeight: 44, fontSize: 15 }} href={app}>Open the app</a></div></header>

      <section className="hero">
        <City>{HERO_CREW.map(([x, y, l]) => <Pin key={l} x={x} y={y} letter={l} />)}</City>
        <div className="walker bob"><Pig size={220} label="Zorion the black pig in a pink chef hat" /></div>
        <div className="wrap" style={{ width: '100%' }}>
          <div className="card">
            <h1 className="display">Good fortune, fair walk.</h1>
            <p>Zorion plans a meetup your whole crew can walk to. Put food on the ballot, send one link, and meet in the fair middle.</p>
            <div className="row"><a className="cta" href={app}>Host a meetup, free</a><span style={{ color: 'var(--muted)', fontWeight: 600 }}>Got a link? Just open it.</span></div>
          </div>
        </div>
      </section>

      {SCENES.map((s) => (
        <section className="scene" key={s.n}>
          <div className="wrap">
            <div className="reveal"><div className="num">{s.n}</div><h2 className="display">{s.title}</h2><p>{s.text}</p></div>
            <div className="art">{s.art}</div>
          </div>
        </section>
      ))}

      <section className="night">
        <div className="wrap">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div className="reveal"><h2 className="display">Go Pro.<br />Go superstar.</h2><p className="lead">Zorion puts on the star shades. Your meetups lose the ads and gain the extras.</p></div>
            <div className="bob"><Pig size={200} star label="Zorion in gold star sunglasses" /></div>
          </div>
          <table className="plans reveal">
            <thead><tr><th scope="col">What you get</th><th scope="col">Free</th><th scope="col">Pro</th></tr></thead>
            <tbody>{PLANS.map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
          </table>
          <div className="row" style={{ marginTop: 32 }}><a className="cta gold" href={`${app}/pro`}>See Pro in the app</a></div>
        </div>
      </section>

      <section className="promises">
        <div className="wrap"><div className="grid">{PROMISES.map(([h, p]) => <div className="tile reveal" key={h}><h3>{h}</h3><p>{p}</p></div>)}</div></div>
      </section>

      {adsAllowed && ads && (
        <div className="adslot"><div className="box"><small>Advertisement</small><ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client={ads.publisherId} data-ad-format="auto" data-full-width-responsive="true" /></div></div>
      )}

      <section className="closing">
        <div className="wrap"><h2 className="display" style={{ fontSize: 'clamp(32px, 5vw, 56px)' }}>Your crew is waiting.</h2><div className="row" style={{ justifyContent: 'center', marginTop: 20 }}><a className="cta" href={app}>Host a meetup, free</a></div></div>
        <div className="giant" aria-hidden="true">Zorion</div>
      </section>
      <footer><span>© {new Date().getFullYear()} Midnight Poetry Studio</span><span>Guests never need an account. Locations are used once and deleted when the meetup ends.</span></footer>

      {ads?.consent && consent === null && (
        <div className="consent" role="dialog" aria-label="Advertising choice">
          <span>This page can show ads from Google. The app itself never does. Allow them here?</span>
          <span className="row"><button onClick={() => decide('no')}>No thanks</button><button className="yes" onClick={() => decide('yes')}>Allow</button></span>
        </div>
      )}
    </div>
  );
}
